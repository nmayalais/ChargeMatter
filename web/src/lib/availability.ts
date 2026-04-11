import type { Charger, Reservation } from '@/types';
import {
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  toDate,
  addMinutes,
  startOfDay,
  buildSlotsForDay,
  dayKey,
} from '@/lib/utils';
import { getReservationConfig } from '@/lib/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AvailableSlot {
  chargerId: string;
  startTime: string;
  endTime: string;
}

export interface TimelineBlock {
  startTime: string;
  endTime: string;
  status: 'available' | 'reserved';
}

export interface ChargerTimeline {
  chargerId: string;
  chargerName: string;
  date: string;
  blocks: TimelineBlock[];
}

export interface CalendarDay {
  date: string;
  totalSlots: number;
  availableSlots: number;
}

// ---------------------------------------------------------------------------
// Reservation conflict check
// ---------------------------------------------------------------------------

/**
 * Returns true if there is a live reservation that conflicts with the
 * given [startTime, endTime) window on the specified charger (including
 * a gap buffer on each side).
 */
export function hasReservationConflict(
  allReservations: Reservation[],
  chargerId: string,
  startTime: Date,
  endTime: Date,
  gapMinutes: number,
): boolean {
  const gapMs = Math.max(0, gapMinutes) * 60_000;
  for (const reservation of allReservations) {
    if (
      isReservationCanceled(reservation) ||
      isReservationNoShow(reservation) ||
      isReservationComplete(reservation)
    ) {
      continue;
    }
    if (reservation.chargerId !== chargerId) continue;
    const existingStart = toDate(reservation.startTime);
    const existingEnd = toDate(reservation.endTime);
    if (!existingStart || !existingEnd) continue;

    const conflict =
      startTime.getTime() < existingEnd.getTime() + gapMs &&
      endTime.getTime() > existingStart.getTime() - gapMs;
    if (conflict) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reservation open time
// ---------------------------------------------------------------------------

/**
 * Get the time that reservations open for the day (Pacific Time).
 * Uses Pacific midnight as the base so the open time is always in LA,
 * regardless of the server's system timezone.
 */
export function getReservationOpenTime(
  now: Date,
  config: { openHour: number; openMinute: number },
): Date {
  const openHour = isNaN(config.openHour) ? 5 : config.openHour;
  const openMinute = isNaN(config.openMinute) ? 45 : config.openMinute;
  return addMinutes(startOfDay(now), openHour * 60 + openMinute);
}

// ---------------------------------------------------------------------------
// Next available slots
// ---------------------------------------------------------------------------

export interface GetNextAvailableSlotsOpts {
  now: Date;
  chargers: Charger[];
  reservations: Reservation[];
  configMap: Record<string, string>;
  rangeDays?: number;
  limit?: number;
  offset?: number;
}

/**
 * Find the next available (unreserved) slots across all chargers, starting
 * from `now` and looking ahead up to `rangeDays`.
 *
 * Mirrors `getNextAvailableSlots_()` from engine.js.
 */
export function getNextAvailableSlots(opts: GetNextAvailableSlotsOpts): AvailableSlot[] {
  const {
    now,
    chargers,
    reservations,
    configMap,
    rangeDays = 1,
    limit = 10,
    offset = 0,
  } = opts;

  const config = getReservationConfig(configMap);
  const openTime = getReservationOpenTime(now, config);
  if (now.getTime() < openTime.getTime()) return [];

  const slots: { chargerId: string; startTime: Date; endTime: Date }[] = [];
  const day = startOfDay(now);

  for (let d = 0; d < rangeDays; d++) {
    const currentDay = d === 0 ? day : addMinutes(day, d * 1440);

    for (const charger of chargers) {
      if (charger.maxMinutes <= 0) continue;
      const daySlots = buildSlotsForDay(charger.slotStarts, charger.maxMinutes, currentDay);
      for (const slot of daySlots) {
        if (slot.startTime.getTime() < now.getTime()) continue;
        const conflict = hasReservationConflict(
          reservations,
          charger.id,
          slot.startTime,
          slot.endTime,
          config.gapMinutes,
        );
        if (!conflict) {
          slots.push({
            chargerId: charger.id,
            startTime: slot.startTime,
            endTime: slot.endTime,
          });
        }
      }
    }
  }

  slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return slots.slice(offset, offset + limit).map((slot) => ({
    chargerId: slot.chargerId,
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Timeline for a single charger
// ---------------------------------------------------------------------------

export interface BuildTimelineOpts {
  charger: Charger;
  day: Date;
  reservations: Reservation[];
  configMap: Record<string, string>;
}

/**
 * Build a timeline view for a single charger on a given day.
 * Each slot is either "available" or "reserved".
 */
export function buildTimelineForCharger(opts: BuildTimelineOpts): ChargerTimeline {
  const { charger, day, reservations, configMap } = opts;
  const config = getReservationConfig(configMap);
  const start = startOfDay(day);

  if (charger.maxMinutes <= 0) {
    return {
      chargerId: charger.id,
      chargerName: charger.name || `Charger ${charger.id}`,
      date: dayKey(start),
      blocks: [],
    };
  }

  const daySlots = buildSlotsForDay(charger.slotStarts, charger.maxMinutes, start);
  const blocks: TimelineBlock[] = daySlots.map((slot) => {
    const conflict = hasReservationConflict(
      reservations,
      charger.id,
      slot.startTime,
      slot.endTime,
      config.gapMinutes,
    );
    return {
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      status: conflict ? 'reserved' : 'available',
    };
  });

  return {
    chargerId: charger.id,
    chargerName: charger.name || `Charger ${charger.id}`,
    date: dayKey(start),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Calendar availability
// ---------------------------------------------------------------------------

export interface BuildCalendarDayOpts {
  day: Date;
  chargers: Charger[];
  reservations: Reservation[];
  configMap: Record<string, string>;
}

/**
 * Build availability summary for a single day across all chargers.
 */
export function buildCalendarDay(opts: BuildCalendarDayOpts): CalendarDay {
  const { day, chargers, reservations, configMap } = opts;
  const config = getReservationConfig(configMap);
  const start = startOfDay(day);
  let totalSlots = 0;
  let availableSlots = 0;

  for (const charger of chargers) {
    if (charger.maxMinutes <= 0) continue;
    const daySlots = buildSlotsForDay(charger.slotStarts, charger.maxMinutes, start);
    for (const slot of daySlots) {
      totalSlots += 1;
      const conflict = hasReservationConflict(
        reservations,
        charger.id,
        slot.startTime,
        slot.endTime,
        config.gapMinutes,
      );
      if (!conflict) {
        availableSlots += 1;
      }
    }
  }

  return {
    date: dayKey(start),
    totalSlots,
    availableSlots,
  };
}
