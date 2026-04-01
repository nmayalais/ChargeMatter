'use server';

import { db } from '@/lib/db';
import { sessions, chargers, reservations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConfig, getReservationConfig } from '@/lib/config';
import { assertNotSuspended } from '@/lib/auth-helpers';
import { getChargers, getAllSessions, getAllReservations, getActiveSessions, getOnboardingComplete } from '@/lib/queries';
import { buildBoard, isNetNewUser, isReturningUser, findReservationForSlot } from '@/lib/board';
import { getUpcomingReservationsForUser } from '@/lib/user-reservations';
import { getActiveSuspensionForUser } from '@/lib/auth-helpers';
import {
  isComplete,
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  toDate,
  addMinutes,
  findSlotForTime,
  formatTime,
  formatUserDisplay,
  serializeSuspension,
} from '@/lib/utils';
import type { Auth, BoardData, Session, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a full board response after a mutation, mirroring buildBoardResponse_()
 * from engine.js. Re-reads mutated tables to reflect the latest state.
 */
async function buildBoardResponse(auth: Auth, now: Date): Promise<BoardData> {
  const [configMap, chargerRows, sessionRows, reservationRows, suspension, onboardingComplete] =
    await Promise.all([
      getConfig(),
      getChargers(),
      getAllSessions(),
      getAllReservations(),
      getActiveSuspensionForUser(auth.email),
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

  const enrichedAuth: Auth = { ...auth };
  if (suspension) {
    enrichedAuth.suspension = serializeSuspension(suspension);
  }
  enrichedAuth.isNetNew = isNetNewUser(auth.email, sessionRows, reservationRows, now);
  enrichedAuth.isReturning = isReturningUser(auth.email, sessionRows, reservationRows, now);

  return {
    user: enrichedAuth,
    chargers: board.chargers,
    reservations: userReservations,
    serverTime: board.serverTime,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    config: board.config,
    onboardingComplete,
  };
}

/**
 * Find the active (non-complete) session for a given user.
 */
function findActiveSessionForUser(
  allSessions: Session[],
  userEmail: string,
): Session | null {
  const email = (userEmail || '').toLowerCase();
  for (const session of allSessions) {
    if (!session.id) continue;
    if (isComplete(session)) continue;
    if (session.userId.toLowerCase() === email) {
      return session;
    }
  }
  return null;
}

/**
 * Find a live reservation for the user at the given time, optionally excluding
 * a specific charger (used to allow starting a session on a charger you reserved).
 */
function findUserReservationAtTime(
  allReservations: Reservation[],
  userEmail: string,
  moment: Date,
  excludeChargerId?: string,
): Reservation | null {
  const email = (userEmail || '').toLowerCase();
  const target = moment.getTime();
  for (const reservation of allReservations) {
    if (!reservation.id) continue;
    if (
      isReservationCanceled(reservation) ||
      isReservationNoShow(reservation) ||
      isReservationComplete(reservation)
    ) {
      continue;
    }
    if (reservation.userId.toLowerCase() !== email) continue;
    if (excludeChargerId && reservation.chargerId === excludeChargerId) continue;
    const start = toDate(reservation.startTime);
    const end = toDate(reservation.endTime);
    if (!start || !end) continue;
    if (target >= start.getTime() && target < end.getTime()) {
      return reservation;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// completeReservationForSession
// ---------------------------------------------------------------------------

/**
 * Mark the checked-in reservation matching this session as complete.
 * If the session ended before the halfway point of the reservation window,
 * stamp `released_early = true` to preserve the user's net-new status.
 */
export async function completeReservationForSession(
  session: Session,
  now: Date,
  allReservations?: Reservation[],
): Promise<void> {
  const reservationRows = allReservations ?? await getAllReservations();

  const sessionStart = toDate(session.startTime);
  const sessionEnd = toDate(session.endTime);
  if (!sessionStart || !sessionEnd) return;

  const userEmail = (session.userId || '').toLowerCase();
  const chargerId = session.chargerId || '';

  for (const reservation of reservationRows) {
    if (
      !reservation.id ||
      isReservationCanceled(reservation) ||
      isReservationNoShow(reservation) ||
      isReservationComplete(reservation)
    ) {
      continue;
    }
    // Only complete checked-in reservations
    if (!reservation.checkedInAt) continue;
    if (reservation.userId.toLowerCase() !== userEmail) continue;
    if (reservation.chargerId !== chargerId) continue;

    const resStart = toDate(reservation.startTime);
    const resEnd = toDate(reservation.endTime);
    if (!resStart || !resEnd) continue;

    const overlaps =
      sessionStart.getTime() < resEnd.getTime() &&
      sessionEnd.getTime() > resStart.getTime();
    if (!overlaps) continue;

    const halfwayTime = new Date(
      resStart.getTime() + (resEnd.getTime() - resStart.getTime()) / 2,
    );
    const releasedEarly = now.getTime() < halfwayTime.getTime();

    await db
      .update(reservations)
      .set({
        status: 'complete',
        endTime: now,
        releasedEarly,
        updatedAt: now,
      })
      .where(eq(reservations.id, reservation.id));
  }
}

// ---------------------------------------------------------------------------
// endSessionInternal
// ---------------------------------------------------------------------------

/**
 * Shared logic for ending a session: marks it complete, clears the charger
 * reference, and completes the matching reservation.
 */
export async function endSessionInternal(
  sessionId: string,
  auth: Auth,
  adminOverride: boolean = false,
): Promise<void> {
  // Find the session
  const [sessionRow] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!sessionRow) {
    throw new Error('Session not found.');
  }

  if (
    !adminOverride &&
    !auth.isAdmin &&
    sessionRow.userId.toLowerCase() !== auth.email.toLowerCase()
  ) {
    throw new Error('You can only end your own session.');
  }

  const now = new Date();

  // Mark session complete
  await db
    .update(sessions)
    .set({
      status: 'complete',
      active: false,
      overdue: false,
      complete: true,
      endedAt: now,
    })
    .where(eq(sessions.id, sessionId));

  // Clear charger active_session_id
  const [charger] = await db
    .select()
    .from(chargers)
    .where(eq(chargers.id, sessionRow.chargerId))
    .limit(1);

  if (charger && charger.activeSessionId === sessionId) {
    await db
      .update(chargers)
      .set({ activeSessionId: null })
      .where(eq(chargers.id, sessionRow.chargerId));
  }

  // Complete matching reservation
  await completeReservationForSession(sessionRow, now);
}

// ---------------------------------------------------------------------------
// startSession
// ---------------------------------------------------------------------------

/**
 * Start a new charging session on a charger.
 *
 * Validates suspension status, charger availability, walk-up eligibility
 * windows, and creates the session row + updates the charger reference.
 */
export async function startSession(
  chargerId: string,
  auth: Auth,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  // 1. Assert not suspended
  await assertNotSuspended(auth.email);

  // 2. Fetch data in parallel
  const [configMap, chargerRows, sessionRows, reservationRows] =
    await Promise.all([
      getConfig(),
      getChargers(),
      getAllSessions(),
      getAllReservations(),
    ]);

  // 3. Find and validate charger
  const charger = chargerRows.find((c) => c.id === chargerId);
  if (!charger) {
    throw new Error('Charger not found.');
  }
  const maxMinutes = charger.maxMinutes || 0;
  if (maxMinutes <= 0) {
    throw new Error('Charger max minutes is not configured.');
  }

  const now = new Date();
  const resConfig = getReservationConfig(configMap);

  // 4. Check user doesn't already have an active session
  const activeSession = findActiveSessionForUser(sessionRows, auth.email);
  if (activeSession) {
    const activeCharger = chargerRows.find((c) => c.id === activeSession.chargerId);
    const activeName = activeCharger
      ? activeCharger.name || `Charger ${activeCharger.id}`
      : 'another charger';
    throw new Error(
      `You already have an active session on ${activeName}. End it before starting another.`,
    );
  }

  // 5. Check user doesn't have a conflicting reservation on another charger
  const conflictingReservation = findUserReservationAtTime(
    reservationRows,
    auth.email,
    now,
    chargerId,
  );
  if (conflictingReservation) {
    const reservedCharger = chargerRows.find(
      (c) => c.id === conflictingReservation.chargerId,
    );
    const reservedName = reservedCharger
      ? reservedCharger.name || `Charger ${reservedCharger.id}`
      : 'another charger';
    throw new Error(
      `You already have a reservation on ${reservedName} at this time.`,
    );
  }

  // 6. Find the current slot
  const slot = findSlotForTime(charger.slotStarts, maxMinutes, now);
  if (!slot) {
    throw new Error('Charging is only available during scheduled blocks.');
  }

  // 7. Check walk-up windows
  let slotReservation = findReservationForSlot(
    reservationRows,
    chargerId,
    slot.startTime,
  );
  // Ignore dead reservations
  if (
    slotReservation &&
    (isReservationCanceled(slotReservation) ||
      isReservationNoShow(slotReservation) ||
      isReservationComplete(slotReservation))
  ) {
    slotReservation = null;
  }

  const openAt = slotReservation
    ? addMinutes(slot.startTime, resConfig.lateGraceMinutes)
    : slot.startTime;
  const allUsersOpenAt = addMinutes(openAt, resConfig.netNewWindowMinutes);
  const returningUsersOpenAt = addMinutes(
    allUsersOpenAt,
    resConfig.returningWindowMinutes,
  );

  const isReservedByUser =
    !!slotReservation &&
    slotReservation.userId.toLowerCase() === auth.email.toLowerCase();

  // Before open: only reservation holder can start
  if (now.getTime() < openAt.getTime()) {
    if (!slotReservation) {
      throw new Error(
        `This slot opens at ${formatTime(openAt)} for walk-up charging.`,
      );
    }
    if (!isReservedByUser) {
      const reservedBy = formatUserDisplay(
        slotReservation.userName,
        slotReservation.userId,
      );
      throw new Error(
        `Charger is reserved by ${reservedBy} until ${formatTime(openAt)}.`,
      );
    }
  }

  // Tier 1: net-new users only
  if (
    now.getTime() >= openAt.getTime() &&
    now.getTime() < allUsersOpenAt.getTime() &&
    !isReservedByUser
  ) {
    if (!isNetNewUser(auth.email, sessionRows, reservationRows, now)) {
      throw new Error(
        `This slot is currently reserved for first-time drivers today. Available to returning drivers at ${formatTime(allUsersOpenAt)}.`,
      );
    }
  }

  // Tier 2: returning users (+ net-new)
  if (
    now.getTime() >= allUsersOpenAt.getTime() &&
    now.getTime() < returningUsersOpenAt.getTime() &&
    !isReservedByUser
  ) {
    if (
      !isNetNewUser(auth.email, sessionRows, reservationRows, now) &&
      !isReturningUser(auth.email, sessionRows, reservationRows, now)
    ) {
      throw new Error(
        `This slot is currently reserved for drivers who have charged or reserved today. Available to everyone at ${formatTime(returningUsersOpenAt)}.`,
      );
    }
  }

  // 8. Check charger not already in use
  if (charger.activeSessionId) {
    const existingSession = sessionRows.find(
      (s) => s.id === charger.activeSessionId,
    );
    if (existingSession && !isComplete(existingSession)) {
      throw new Error('Charger is already in use.');
    }
    // Stale reference — clear it
    await db
      .update(chargers)
      .set({ activeSessionId: null })
      .where(eq(chargers.id, chargerId));
  }

  // 9. Create session
  const endTime = slot.endTime;
  const [newSession] = await db
    .insert(sessions)
    .values({
      chargerId,
      userId: auth.email,
      userName: auth.name,
      startTime: now,
      endTime,
      status: 'active',
      active: true,
      overdue: false,
      complete: false,
      reminder10Sent: false,
      reminder5Sent: false,
      reminder0Sent: false,
    })
    .returning({ id: sessions.id });

  // 10. Update charger active_session_id
  await db
    .update(chargers)
    .set({ activeSessionId: newSession.id })
    .where(eq(chargers.id, chargerId));

  // 11. Return updated board
  return buildBoardResponse(auth, now);
}

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------

/**
 * End a specific session by ID. Only the session owner or an admin can end it.
 */
export async function endSession(
  sessionId: string,
  auth: Auth,
  adminOverride: boolean = false,
): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  await endSessionInternal(sessionId, auth, adminOverride);

  const now = new Date();
  return buildBoardResponse(auth, now);
}

// ---------------------------------------------------------------------------
// endMyActiveSession
// ---------------------------------------------------------------------------

/**
 * End the calling user's currently active session.
 */
export async function endMyActiveSession(auth: Auth): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  const sessionRows = await getActiveSessions();
  const activeSession = findActiveSessionForUser(sessionRows, auth.email);
  if (!activeSession) {
    throw new Error('Active session not found.');
  }

  await endSessionInternal(activeSession.id, auth, false);

  const now = new Date();
  return buildBoardResponse(auth, now);
}
