import type { Charger, Session, Reservation } from '@/types';
import {
  isComplete,
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  toDate,
  addMinutes,
  findSlotForTime,
  dayKey,
  isTrue,
  serializeSession,
  serializeReservation,
} from '@/lib/utils';
import { getReservationConfig } from '@/lib/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalkupInfo {
  startTime: string;
  endTime: string;
  openAt: string;
  allUsersOpenAt: string;
  returningUsersOpenAt: string;
  isOpen: boolean;
  isOpenToReturning: boolean;
  isOpenToAll: boolean;
}

export interface ChargerView {
  id: string;
  name: string;
  maxMinutes: number;
  status: string;
  statusKey: string;
  session: ReturnType<typeof serializeSession> | null;
  reservation: ReturnType<typeof serializeReservation> | null;
  nextReservation: ReturnType<typeof serializeReservation> | null;
  walkup: WalkupInfo | null;
}

export interface BoardResult {
  chargers: ChargerView[];
  serverTime: string;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reservation grouping
// ---------------------------------------------------------------------------

interface GroupedReservations {
  active: Record<string, Reservation>;
  next: Record<string, Reservation>;
}

/**
 * Group live reservations by charger into "currently active" and "next upcoming".
 */
export function groupReservationsByCharger(
  allReservations: Reservation[],
  now: Date,
): GroupedReservations {
  const active: Record<string, Reservation> = {};
  const next: Record<string, Reservation> = {};

  for (const reservation of allReservations) {
    if (
      isReservationCanceled(reservation) ||
      isReservationNoShow(reservation) ||
      isReservationComplete(reservation)
    ) {
      continue;
    }

    const startTime = toDate(reservation.startTime);
    const endTime = toDate(reservation.endTime);
    if (!startTime || !endTime) continue;

    const chargerId = reservation.chargerId;

    if (now.getTime() >= startTime.getTime() && now.getTime() < endTime.getTime()) {
      // Currently active — keep the earliest-starting one (guards against stale unprocessed reservations)
      if (!active[chargerId]) {
        active[chargerId] = reservation;
      } else {
        const existingStart = toDate(active[chargerId].startTime);
        if (existingStart && startTime.getTime() < existingStart.getTime()) {
          active[chargerId] = reservation;
        }
      }
    } else if (startTime.getTime() > now.getTime()) {
      // Future — keep the soonest
      if (!next[chargerId]) {
        next[chargerId] = reservation;
      } else {
        const existingStart = toDate(next[chargerId].startTime);
        if (existingStart && startTime.getTime() < existingStart.getTime()) {
          next[chargerId] = reservation;
        }
      }
    }
  }

  return { active, next };
}

// ---------------------------------------------------------------------------
// Find reservation for a specific slot
// ---------------------------------------------------------------------------

/**
 * Find the live reservation that starts exactly at `slotStart` for a given charger.
 */
export function findReservationForSlot(
  allReservations: Reservation[],
  chargerId: string,
  slotStart: Date,
): Reservation | null {
  const slotStartMs = slotStart.getTime();
  for (const reservation of allReservations) {
    if (
      isReservationCanceled(reservation) ||
      isReservationNoShow(reservation) ||
      isReservationComplete(reservation)
    ) {
      continue;
    }
    if (reservation.chargerId !== chargerId) continue;
    const resStart = toDate(reservation.startTime);
    if (resStart && resStart.getTime() === slotStartMs) {
      return reservation;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Net-new / returning user logic
// ---------------------------------------------------------------------------

/**
 * A user is "net new" if they have NOT used any charger today (no session and
 * no non-canceled reservation). Early-released sessions/reservations and early
 * cancellations preserve net-new status.
 */
export function isNetNewUser(
  userEmail: string,
  allSessions: Session[],
  allReservations: Reservation[],
  now: Date,
): boolean {
  const email = userEmail.toLowerCase();
  const todayKey = dayKey(now);

  // Check for disqualifying sessions today
  const hasDisqualifyingSession = allSessions.some((session) => {
    if (!session.id) return false;
    if (session.userId.toLowerCase() !== email) return false;
    const sessionStart = toDate(session.startTime);
    if (!sessionStart || dayKey(sessionStart) !== todayKey) return false;

    // A session from an early-released reservation does not disqualify
    const sessionChargerId = session.chargerId;
    const sessionEnd = toDate(session.endTime);
    const hasMatchingEarlyRelease = allReservations.some((reservation) => {
      if (!isReservationComplete(reservation)) return false;
      if (!isTrue(reservation.releasedEarly)) return false;
      if (reservation.userId.toLowerCase() !== email) return false;
      if (reservation.chargerId !== sessionChargerId) return false;
      const resStart = toDate(reservation.startTime);
      const resEnd = toDate(reservation.endTime);
      if (!resStart || !resEnd) return false;
      const sEnd = sessionEnd || new Date(sessionStart.getTime() + 1);
      return sessionStart.getTime() < resEnd.getTime() && sEnd.getTime() > resStart.getTime();
    });
    return !hasMatchingEarlyRelease;
  });

  if (hasDisqualifyingSession) return false;

  // Check for disqualifying reservations today
  const hasTodayReservation = allReservations.some((reservation) => {
    if (!reservation.id) return false;
    if (reservation.userId.toLowerCase() !== email) return false;
    const start = toDate(reservation.startTime);
    if (!start || dayKey(start) !== todayKey) return false;

    if (isReservationCanceled(reservation)) {
      const end = toDate(reservation.endTime);
      const canceledAt = toDate(reservation.canceledAt);
      if (end && canceledAt) {
        const halfwayTime = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
        if (canceledAt.getTime() < halfwayTime.getTime()) {
          return false; // early cancellation — still net-new
        }
      }
      return true; // late cancellation — disqualified
    }

    if (isReservationComplete(reservation) && isTrue(reservation.releasedEarly)) {
      return false; // early-released — still net-new
    }

    return true; // no-show, late-complete, and active all disqualify
  });

  return !hasTodayReservation;
}

/**
 * Returns true if the user had prior charged/reserved activity today but is not
 * currently holding an active reservation or session. Used to grant returning-user
 * second priority during the walk-up window.
 */
export function isReturningUser(
  userEmail: string,
  allSessions: Session[],
  allReservations: Reservation[],
  now: Date,
): boolean {
  const email = userEmail.toLowerCase();
  const todayKey = dayKey(now);

  const hasQualifyingSession = allSessions.some((session) => {
    if (!session.id) return false;
    if (session.userId.toLowerCase() !== email) return false;
    const sessionStart = toDate(session.startTime);
    if (!sessionStart || dayKey(sessionStart) !== todayKey) return false;

    // A session from an early-released reservation does not count as returning
    const sessionChargerId = session.chargerId;
    const sessionEnd = toDate(session.endTime);
    const hasMatchingEarlyRelease = allReservations.some((reservation) => {
      if (!isReservationComplete(reservation)) return false;
      if (!isTrue(reservation.releasedEarly)) return false;
      if (reservation.userId.toLowerCase() !== email) return false;
      if (reservation.chargerId !== sessionChargerId) return false;
      const resStart = toDate(reservation.startTime);
      const resEnd = toDate(reservation.endTime);
      if (!resStart || !resEnd) return false;
      const sEnd = sessionEnd || new Date(sessionStart.getTime() + 1);
      return sessionStart.getTime() < resEnd.getTime() && sEnd.getTime() > resStart.getTime();
    });
    return !hasMatchingEarlyRelease;
  });

  if (hasQualifyingSession) return true;

  return allReservations.some((reservation) => {
    if (!reservation.id) return false;
    if (reservation.userId.toLowerCase() !== email) return false;
    const start = toDate(reservation.startTime);
    if (!start || dayKey(start) !== todayKey) return false;

    if (isReservationNoShow(reservation)) return true;
    if (isReservationComplete(reservation)) {
      return !isTrue(reservation.releasedEarly); // early-released = not returning
    }
    if (isReservationCanceled(reservation)) {
      const end = toDate(reservation.endTime);
      const canceledAt = toDate(reservation.canceledAt);
      if (end && canceledAt) {
        const halfwayTime = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
        return canceledAt.getTime() >= halfwayTime.getTime();
      }
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// buildBoard — the core board-building function
// ---------------------------------------------------------------------------

export interface BuildBoardOpts {
  now: Date;
  chargers: Charger[];
  sessions: Session[];
  reservations: Reservation[];
  configMap: Record<string, string>;
}

/**
 * Build the charger board view from raw data.
 *
 * This is the read-only equivalent of `buildBoard_()` from engine.js.
 * Unlike the original, this version does NOT perform side-effect writes
 * (clearing stale session IDs, updating overdue status) — those will be
 * handled by separate mutation actions in a later migration phase.
 */
export function buildBoard(opts: BuildBoardOpts): BoardResult {
  const { now, chargers: chargerRows, sessions: sessionRows, reservations: reservationRows, configMap } = opts;

  const reservationConfig = getReservationConfig(configMap);
  const sessionMoveGraceMinutes =
    Number(configMap.session_move_grace_minutes) || 10;

  // Index sessions by ID
  const sessionsById: Record<string, Session> = {};
  for (const session of sessionRows) {
    if (session.id) {
      sessionsById[session.id] = session;
    }
  }

  // Group reservations for the board
  const reservationsByCharger = groupReservationsByCharger(reservationRows, now);

  const chargersView: ChargerView[] = chargerRows
    .filter((charger) => !!charger.id)
    .map((charger) => {
      // Find active session for this charger
      let session: Session | null = null;
      if (charger.activeSessionId) {
        const candidate = sessionsById[charger.activeSessionId];
        if (candidate && !isComplete(candidate)) {
          session = candidate;
        }
      }

      let statusKey = 'free';
      let statusLabel = 'Open';
      const activeReservation = reservationsByCharger.active[charger.id] || null;
      const nextReservation = reservationsByCharger.next[charger.id] || null;
      let walkup: WalkupInfo | null = null;

      if (session) {
        const endTime = toDate(session.endTime);
        const graceCutoff = endTime
          ? addMinutes(endTime, sessionMoveGraceMinutes)
          : null;
        const isOverdue =
          !!graceCutoff && now.getTime() >= graceCutoff.getTime();

        statusKey = isOverdue ? 'overdue' : 'in_use';
        statusLabel = isOverdue ? 'Overdue' : 'In use';
      } else if (activeReservation) {
        statusKey = 'reserved';
        statusLabel = 'Reserved';
      } else {
        // Compute walkup info for the current slot
        const slot = findSlotForTime(charger.slotStarts, charger.maxMinutes, now);
        if (slot) {
          const slotReservation = findReservationForSlot(
            reservationRows,
            charger.id,
            slot.startTime,
          );

          // Only consider live reservations for walkup calculation
          const liveSlotReservation =
            slotReservation &&
            !isReservationCanceled(slotReservation) &&
            !isReservationNoShow(slotReservation) &&
            !isReservationComplete(slotReservation)
              ? slotReservation
              : null;

          const openAt = liveSlotReservation
            ? addMinutes(slot.startTime, reservationConfig.lateGraceMinutes)
            : slot.startTime;
          const allUsersOpenAt = addMinutes(
            openAt,
            reservationConfig.netNewWindowMinutes,
          );
          const returningUsersOpenAt = addMinutes(
            allUsersOpenAt,
            reservationConfig.returningWindowMinutes,
          );

          walkup = {
            startTime: slot.startTime.toISOString(),
            endTime: slot.endTime.toISOString(),
            openAt: openAt.toISOString(),
            allUsersOpenAt: allUsersOpenAt.toISOString(),
            returningUsersOpenAt: returningUsersOpenAt.toISOString(),
            isOpen: now.getTime() >= openAt.getTime(),
            isOpenToReturning: now.getTime() >= allUsersOpenAt.getTime(),
            isOpenToAll: now.getTime() >= returningUsersOpenAt.getTime(),
          };
        }
      }

      return {
        id: charger.id,
        name: charger.name || `Charger ${charger.id}`,
        maxMinutes: charger.maxMinutes,
        status: statusLabel,
        statusKey,
        session: session ? serializeSession(session) : null,
        reservation: activeReservation
          ? serializeReservation(activeReservation)
          : null,
        nextReservation: nextReservation
          ? serializeReservation(nextReservation)
          : null,
        walkup,
      };
    });

  return {
    chargers: chargersView,
    serverTime: now.toISOString(),
    config: {
      appName: configMap.app_name || 'EV Charging',
      slackChannelName: configMap.slack_channel_name || '',
      slackChannelUrl: configMap.slack_channel_url || '',
      overdueRepeatMinutes:
        Number(configMap.overdue_repeat_minutes) || 15,
      sessionMoveGraceMinutes,
      suspensionBusinessDays:
        Number(configMap.suspension_business_days) || 2,
      reservationAdvanceDays: reservationConfig.advanceDays,
      reservationMaxUpcoming: reservationConfig.maxUpcoming,
      reservationMaxPerDay: reservationConfig.maxPerDay,
      reservationGapMinutes: reservationConfig.gapMinutes,
      reservationRoundingMinutes: reservationConfig.roundingMinutes,
      reservationCheckinEarlyMinutes: reservationConfig.checkinEarlyMinutes,
      reservationEarlyStartMinutes: reservationConfig.earlyStartMinutes,
      reservationLateGraceMinutes: reservationConfig.lateGraceMinutes,
      reservationOpenHour: reservationConfig.openHour,
      reservationOpenMinute: reservationConfig.openMinute,
      walkupNetNewWindowMinutes: reservationConfig.netNewWindowMinutes,
      walkupReturningWindowMinutes: reservationConfig.returningWindowMinutes,
    },
  };
}
