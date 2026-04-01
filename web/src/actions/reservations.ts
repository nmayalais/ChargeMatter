'use server';

import { db } from '@/lib/db';
import { reservations, sessions, chargers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConfig, getReservationConfig } from '@/lib/config';
import { assertNotSuspended } from '@/lib/auth-helpers';
import { getChargers, getAllSessions, getAllReservations, getOnboardingComplete } from '@/lib/queries';
import { buildBoard } from '@/lib/board';
import { getReservationOpenTime } from '@/lib/availability';
import { getUpcomingReservationsForUser } from '@/lib/user-reservations';
import {
  toDate,
  addMinutes,
  isSlotStart,
  isSameDay,
  dayKey,
  formatTime,
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  isComplete,
  isTrue,
} from '@/lib/utils';
import type { Auth, BoardData, Charger, Session, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build and return a full BoardData response after a mutation.
 * Re-reads all data to ensure consistency.
 */
async function buildBoardResponse(auth: Auth): Promise<BoardData> {
  const now = new Date();
  const [configMap, chargerRows, sessionRows, reservationRows, onboardingComplete] =
    await Promise.all([
      getConfig(),
      getChargers(),
      getAllSessions(),
      getAllReservations(),
      getOnboardingComplete(auth.email.toLowerCase()),
    ]);

  const board = buildBoard({
    now,
    chargers: chargerRows,
    sessions: sessionRows,
    reservations: reservationRows,
    configMap,
  });

  const userReservations = getUpcomingReservationsForUser(
    reservationRows,
    auth.email,
    now,
  );

  return {
    user: auth,
    chargers: board.chargers,
    reservations: userReservations,
    serverTime: board.serverTime,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    config: board.config,
    onboardingComplete,
  };
}

/**
 * Find an active (non-complete) session for a user.
 */
function findActiveSessionForUser(
  allSessions: Session[],
  email: string,
): Session | null {
  const normalized = email.toLowerCase();
  for (const session of allSessions) {
    if (!session.id) continue;
    if (isComplete(session)) continue;
    if (session.userId.toLowerCase() === normalized) return session;
  }
  return null;
}

/**
 * Validate a reservation create/update against all business rules.
 * Throws on any violation.
 */
async function validateReservation(params: {
  charger: Charger;
  startTime: Date;
  endTime: Date;
  auth: Auth;
  now: Date;
  allReservations: Reservation[];
  allSessions: Session[];
  excludeReservationId: string;
}): Promise<void> {
  const {
    charger,
    startTime,
    endTime,
    auth,
    now,
    allReservations,
    allSessions,
    excludeReservationId,
  } = params;

  const configMap = await getConfig();
  const config = getReservationConfig(configMap);
  const userEmail = auth.email.toLowerCase();

  // Must be in the future
  if (startTime.getTime() < now.getTime()) {
    throw new Error('Reservation time must be in the future.');
  }

  // Booking open time check
  const openTime = getReservationOpenTime(now, config);
  if (now.getTime() < openTime.getTime()) {
    throw new Error(
      `Booking opens at ${formatTime(openTime)} for same-day slots.`,
    );
  }

  // Same-day only (advance_days = 0 means today only)
  if (!isSameDay(startTime, now)) {
    throw new Error('Reservations can only be made for today.');
  }

  // Must align to a valid slot start
  if (!isSlotStart(charger.slotStarts, startTime)) {
    throw new Error('Reservations must start at a scheduled slot time.');
  }

  // Check for active session that would overlap
  const activeSession = findActiveSessionForUser(allSessions, auth.email);
  if (activeSession) {
    const sessionStart = toDate(activeSession.startTime);
    const sessionEnd = toDate(activeSession.endTime);
    if (!sessionStart || !sessionEnd) {
      throw new Error(
        'You already have an active session. End it before booking another slot.',
      );
    }
    const overlaps =
      startTime.getTime() < sessionEnd.getTime() &&
      endTime.getTime() > sessionStart.getTime();
    if (overlaps) {
      throw new Error(
        'You already have an active session that overlaps this reservation.',
      );
    }
  }

  // Max per day check (exclude canceled and early-released-complete)
  const todayKey = dayKey(startTime);
  const perDayCount = allReservations.filter((r) => {
    if (!r.id || isReservationCanceled(r)) return false;
    if (isReservationComplete(r) && isTrue(r.releasedEarly)) return false;
    if (r.id === excludeReservationId) return false;
    if (r.userId.toLowerCase() !== userEmail) return false;
    const resStart = toDate(r.startTime);
    return resStart ? dayKey(resStart) === todayKey : false;
  }).length;

  if (perDayCount >= config.maxPerDay) {
    throw new Error(
      'You already have a reservation for today. Change or cancel it to book another.',
    );
  }

  // Max upcoming check
  const upcoming = allReservations.filter((r) => {
    if (
      !r.id ||
      isReservationCanceled(r) ||
      isReservationNoShow(r) ||
      isReservationComplete(r)
    ) {
      return false;
    }
    if (r.id === excludeReservationId) return false;
    const end = toDate(r.endTime);
    if (!end || end.getTime() < now.getTime()) return false;
    return r.userId.toLowerCase() === userEmail;
  });

  if (upcoming.length >= config.maxUpcoming) {
    throw new Error(
      `You can only have ${config.maxUpcoming} upcoming reservations.`,
    );
  }

  // Charger-level conflict check (includes gap)
  const gapMs = config.gapMinutes * 60_000;
  for (const r of allReservations) {
    if (
      !r.id ||
      isReservationCanceled(r) ||
      isReservationNoShow(r) ||
      isReservationComplete(r)
    ) {
      continue;
    }
    if (r.id === excludeReservationId) continue;
    if (r.chargerId !== charger.id) continue;
    const existingStart = toDate(r.startTime);
    const existingEnd = toDate(r.endTime);
    if (!existingStart || !existingEnd) continue;
    const conflict =
      startTime.getTime() < existingEnd.getTime() + gapMs &&
      endTime.getTime() > existingStart.getTime() - gapMs;
    if (conflict) {
      throw new Error(
        'That time slot conflicts with another reservation on this charger.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// createReservation
// ---------------------------------------------------------------------------

export async function createReservation(
  auth: Auth,
  chargerId: string,
  startTimeIso: string,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');
  await assertNotSuspended(auth.email);

  const now = new Date();
  const [chargerRows, allReservations, allSessions] = await Promise.all([
    getChargers(),
    getAllReservations(),
    getAllSessions(),
  ]);

  const charger = chargerRows.find((c) => c.id === chargerId);
  if (!charger) throw new Error('Charger not found.');

  const startTime = toDate(startTimeIso);
  if (!startTime) throw new Error('Invalid reservation start time.');

  const maxMinutes = charger.maxMinutes || 0;
  if (maxMinutes <= 0) throw new Error('Charger max minutes is not configured.');

  const endTime = addMinutes(startTime, maxMinutes);

  await validateReservation({
    charger,
    startTime,
    endTime,
    auth,
    now,
    allReservations,
    allSessions,
    excludeReservationId: '',
  });

  await db.insert(reservations).values({
    chargerId,
    userId: auth.email,
    userName: auth.name,
    startTime,
    endTime,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  return buildBoardResponse(auth);
}

// ---------------------------------------------------------------------------
// updateReservation
// ---------------------------------------------------------------------------

export async function updateReservation(
  auth: Auth,
  reservationId: string,
  chargerId: string,
  newStartTimeIso: string,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');
  await assertNotSuspended(auth.email);

  const now = new Date();
  const [chargerRows, allReservations, allSessions] = await Promise.all([
    getChargers(),
    getAllReservations(),
    getAllSessions(),
  ]);

  const reservation = allReservations.find((r) => r.id === reservationId);
  if (
    !reservation ||
    isReservationCanceled(reservation) ||
    isReservationNoShow(reservation) ||
    isReservationComplete(reservation)
  ) {
    throw new Error('Reservation not found.');
  }

  if (
    !auth.isAdmin &&
    reservation.userId.toLowerCase() !== auth.email.toLowerCase()
  ) {
    throw new Error('You can only update your own reservations.');
  }

  const charger = chargerRows.find((c) => c.id === chargerId);
  if (!charger) throw new Error('Charger not found.');

  const startTime = toDate(newStartTimeIso);
  if (!startTime) throw new Error('Invalid reservation start time.');

  if (startTime.getTime() < now.getTime()) {
    throw new Error('Reservation time must be in the future.');
  }

  const maxMinutes = charger.maxMinutes || 0;
  if (maxMinutes <= 0) throw new Error('Charger max minutes is not configured.');

  const endTime = addMinutes(startTime, maxMinutes);

  await validateReservation({
    charger,
    startTime,
    endTime,
    auth,
    now,
    allReservations,
    allSessions,
    excludeReservationId: reservationId,
  });

  await db
    .update(reservations)
    .set({
      chargerId,
      startTime,
      endTime,
      status: 'active',
      checkedInAt: null,
      noShowAt: null,
      noShowStrikeAt: null,
      reminder5BeforeSent: false,
      reminder5AfterSent: false,
      canceledAt: null,
      updatedAt: now,
    })
    .where(eq(reservations.id, reservationId));

  return buildBoardResponse(auth);
}

// ---------------------------------------------------------------------------
// cancelReservation
// ---------------------------------------------------------------------------

export async function cancelReservation(
  auth: Auth,
  reservationId: string,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  const now = new Date();
  const allReservations = await getAllReservations();

  const reservation = allReservations.find((r) => r.id === reservationId);
  if (
    !reservation ||
    isReservationCanceled(reservation) ||
    isReservationNoShow(reservation) ||
    isReservationComplete(reservation)
  ) {
    // Silently return board (matches engine.js behavior — no error thrown)
    return buildBoardResponse(auth);
  }

  if (
    !auth.isAdmin &&
    reservation.userId.toLowerCase() !== auth.email.toLowerCase()
  ) {
    throw new Error('You can only cancel your own reservations.');
  }

  await db
    .update(reservations)
    .set({
      status: 'canceled',
      canceledAt: now,
      updatedAt: now,
    })
    .where(eq(reservations.id, reservationId));

  return buildBoardResponse(auth);
}

// ---------------------------------------------------------------------------
// checkInReservation
// ---------------------------------------------------------------------------

export async function checkInReservation(
  auth: Auth,
  reservationId: string,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');
  await assertNotSuspended(auth.email);

  const now = new Date();
  const configMap = await getConfig();
  const config = getReservationConfig(configMap);
  const forceEndEnabled =
    configMap.force_end_on_checkin_enabled !== 'false';

  let [chargerRows, allSessions, allReservations] = await Promise.all([ // eslint-disable-line prefer-const
    getChargers(),
    getAllSessions(),
    getAllReservations(),
  ]);

  const reservation = allReservations.find((r) => r.id === reservationId);
  if (
    !reservation ||
    isReservationCanceled(reservation) ||
    isReservationNoShow(reservation) ||
    isReservationComplete(reservation)
  ) {
    throw new Error('Reservation not found.');
  }

  if (
    !auth.isAdmin &&
    reservation.userId.toLowerCase() !== auth.email.toLowerCase()
  ) {
    throw new Error('You can only check in to your own reservation.');
  }

  const startTime = toDate(reservation.startTime);
  if (!startTime) throw new Error('Invalid reservation start time.');

  const earlyWindowMinutes = config.earlyStartMinutes;
  const earliest = new Date(
    startTime.getTime() - earlyWindowMinutes * 60_000,
  );
  const latest = new Date(
    startTime.getTime() + config.lateGraceMinutes * 60_000,
  );

  if (now.getTime() < earliest.getTime()) {
    throw new Error(`Check-in opens at ${formatTime(earliest)}.`);
  }
  if (now.getTime() > latest.getTime()) {
    throw new Error('This reservation is too late to check in.');
  }

  // Force-end overdue session on this charger if enabled
  const charger = chargerRows.find((c) => c.id === reservation.chargerId);
  if (charger && forceEndEnabled && charger.activeSessionId) {
    const activeSession = allSessions.find(
      (s) => s.id === charger.activeSessionId,
    );
    if (activeSession && !isComplete(activeSession)) {
      const sessionEnd = toDate(activeSession.endTime);
      if (sessionEnd && now.getTime() >= sessionEnd.getTime()) {
        // Force-end the overdue session
        await db
          .update(sessions)
          .set({
            status: 'complete',
            active: false,
            overdue: false,
            complete: true,
            endedAt: now,
          })
          .where(eq(sessions.id, activeSession.id));

        await db
          .update(chargers)
          .set({ activeSessionId: null })
          .where(eq(chargers.id, charger.id));

        // Re-read data after force-end
        [chargerRows, allSessions] = await Promise.all([
          getChargers(),
          getAllSessions(),
        ]);
      }
    }
  }

  // Check if the reservation owner already has an active session
  const ownerEmail = reservation.userId.toLowerCase();
  const existingSession = findActiveSessionForUser(allSessions, ownerEmail);
  if (existingSession) {
    const activeCharger = chargerRows.find(
      (c) => c.id === existingSession.chargerId,
    );
    const activeName = activeCharger
      ? activeCharger.name || `Charger ${activeCharger.id}`
      : 'another charger';
    const subject =
      auth.email.toLowerCase() === ownerEmail
        ? 'You already have'
        : `${reservation.userId} already has`;
    throw new Error(
      `${subject} an active session on ${activeName}. End it before checking in.`,
    );
  }

  // Create a new session for the check-in
  const endTime = toDate(reservation.endTime);
  if (!endTime) throw new Error('Invalid reservation end time.');

  const ownerAuth = {
    email: reservation.userId,
    name: reservation.userName || '',
    isAdmin: false,
  };

  const [insertedSession] = await db
    .insert(sessions)
    .values({
      chargerId: reservation.chargerId,
      userId: ownerAuth.email,
      userName: ownerAuth.name,
      startTime: now,
      endTime,
      status: 'active',
      active: true,
      overdue: false,
      complete: false,
    })
    .returning({ id: sessions.id });

  // Update charger active session
  await db
    .update(chargers)
    .set({ activeSessionId: insertedSession.id })
    .where(eq(chargers.id, reservation.chargerId));

  // Mark reservation as checked in
  if (!reservation.checkedInAt) {
    await db
      .update(reservations)
      .set({
        checkedInAt: now,
        status: 'checked_in',
        updatedAt: now,
      })
      .where(eq(reservations.id, reservationId));
  }

  return buildBoardResponse(auth);
}

// ---------------------------------------------------------------------------
// completeCheckedInReservation
// ---------------------------------------------------------------------------

export async function completeCheckedInReservation(
  auth: Auth,
  reservationId: string,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  const now = new Date();
  const allReservations = await getAllReservations();

  const reservation = allReservations.find((r) => r.id === reservationId);
  if (
    !reservation ||
    isReservationCanceled(reservation) ||
    isReservationNoShow(reservation) ||
    isReservationComplete(reservation)
  ) {
    throw new Error('Reservation not found.');
  }

  if (
    !auth.isAdmin &&
    reservation.userId.toLowerCase() !== auth.email.toLowerCase()
  ) {
    throw new Error('You can only update your own reservations.');
  }

  if (!reservation.checkedInAt) {
    throw new Error('Reservation is not checked in.');
  }

  await db
    .update(reservations)
    .set({
      status: 'complete',
      endTime: now,
      updatedAt: now,
    })
    .where(eq(reservations.id, reservationId));

  return buildBoardResponse(auth);
}
