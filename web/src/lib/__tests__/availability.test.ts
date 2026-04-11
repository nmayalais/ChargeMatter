import { describe, it, expect, vi } from 'vitest';

// Mock the db module to avoid requiring DATABASE_URL
vi.mock('@/lib/db', () => ({
  db: { select: vi.fn() },
}));

import {
  hasReservationConflict,
  getReservationOpenTime,
  getNextAvailableSlots,
  buildTimelineForCharger,
  buildCalendarDay,
} from '@/lib/availability';
import type { Charger, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCharger(overrides: Partial<Charger> = {}): Charger {
  return {
    id: 'C1',
    name: 'Charger 1',
    maxMinutes: 60,
    slotStarts: '8:00,9:00,10:00',
    activeSessionId: null,
    ...overrides,
  };
}

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'R1',
    chargerId: 'C1',
    userId: 'user@example.com',
    userName: 'User',
    startTime: new Date('2026-03-15T09:00:00Z'),
    endTime: new Date('2026-03-15T10:00:00Z'),
    status: 'active',
    checkedInAt: null,
    noShowAt: null,
    noShowStrikeAt: null,
    reminder5BeforeSent: false,
    reminder5AfterSent: false,
    createdAt: new Date('2026-03-14T12:00:00Z'),
    updatedAt: new Date('2026-03-14T12:00:00Z'),
    canceledAt: null,
    releasedEarly: false,
    ...overrides,
  };
}

const DEFAULT_CONFIG: Record<string, string> = {
  reservation_advance_days: '0',
  reservation_max_upcoming: '1',
  reservation_max_per_day: '1',
  reservation_gap_minutes: '1',
  reservation_rounding_minutes: '15',
  reservation_checkin_early_minutes: '0',
  reservation_early_start_minutes: '15',
  reservation_late_grace_minutes: '30',
  reservation_open_hour: '5',
  reservation_open_minute: '45',
  walkup_net_new_window_minutes: '10',
  walkup_returning_window_minutes: '10',
};

// ---------------------------------------------------------------------------
// hasReservationConflict
// ---------------------------------------------------------------------------

describe('hasReservationConflict', () => {
  it('returns false with no reservations', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T10:00:00Z');
    expect(hasReservationConflict([], 'C1', start, end, 1)).toBe(false);
  });

  it('detects an overlapping reservation', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T10:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:30:00Z'),
      endTime: new Date('2026-03-15T10:30:00Z'),
    });
    expect(hasReservationConflict([res], 'C1', start, end, 0)).toBe(true);
  });

  it('detects conflict within gap minutes', () => {
    // Slot ends at 10:00, reservation starts at 10:00 — with 1-min gap, it conflicts
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T10:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T10:00:00Z'),
      endTime: new Date('2026-03-15T11:00:00Z'),
    });
    expect(hasReservationConflict([res], 'C1', start, end, 1)).toBe(true);
  });

  it('returns false for non-overlapping reservation', () => {
    const start = new Date('2026-03-15T08:00:00Z');
    const end = new Date('2026-03-15T09:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T10:00:00Z'),
      endTime: new Date('2026-03-15T11:00:00Z'),
    });
    expect(hasReservationConflict([res], 'C1', start, end, 0)).toBe(false);
  });

  it('ignores canceled reservations', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T10:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: start,
      endTime: end,
      status: 'canceled',
      canceledAt: new Date(),
    });
    expect(hasReservationConflict([res], 'C1', start, end, 0)).toBe(false);
  });

  it('ignores reservations on other chargers', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T10:00:00Z');
    const res = makeReservation({
      chargerId: 'C2',
      startTime: start,
      endTime: end,
    });
    expect(hasReservationConflict([res], 'C1', start, end, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getReservationOpenTime
// ---------------------------------------------------------------------------
// Inputs are UTC ISO strings. Pacific offset: PST = UTC-8, PDT = UTC-7.

// January = PST (UTC-8): midnight PST = 08:00 UTC, 5:45 AM PST = 13:45 UTC
// June = PDT (UTC-7): midnight PDT = 07:00 UTC, 5:45 AM PDT = 12:45 UTC
describe('getReservationOpenTime', () => {
  it('returns 5:45 AM PST on the Pacific calendar day (January)', () => {
    // now = midnight PST Jan 15 = 08:00 UTC
    const now = new Date('2026-01-15T08:00:00Z');
    const result = getReservationOpenTime(now, { openHour: 5, openMinute: 45 });
    // 5:45 AM PST = 08:00Z + 5h45m = 13:45 UTC
    expect(result.toISOString()).toBe('2026-01-15T13:45:00.000Z');
  });

  it('uses Pacific calendar date even when UTC has rolled past midnight', () => {
    // now = 3:00 AM PST Jan 15 = 11:00 UTC
    const now = new Date('2026-01-15T11:00:00Z');
    const result = getReservationOpenTime(now, { openHour: 5, openMinute: 45 });
    // open time is still 5:45 AM PST Jan 15 = 13:45 UTC
    expect(result.toISOString()).toBe('2026-01-15T13:45:00.000Z');
  });

  it('handles PDT (UTC-7) correctly in June', () => {
    // now = noon PDT June 15 = 19:00 UTC
    const now = new Date('2026-06-15T19:00:00Z');
    const result = getReservationOpenTime(now, { openHour: 5, openMinute: 45 });
    // 5:45 AM PDT = 07:00Z + 5h45m = 12:45 UTC
    expect(result.toISOString()).toBe('2026-06-15T12:45:00.000Z');
  });

  it('defaults to 5:45 for NaN inputs', () => {
    const now = new Date('2026-01-15T11:00:00Z');
    const result = getReservationOpenTime(now, { openHour: NaN, openMinute: NaN });
    expect(result.toISOString()).toBe('2026-01-15T13:45:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getNextAvailableSlots
// ---------------------------------------------------------------------------

// January 2026 = PST (UTC-8).
// Charger slots: 8:00, 9:00, 10:00 AM PST = 16:00, 17:00, 18:00 UTC on Jan 15.
// Open time: 5:45 AM PST = 13:45 UTC.

describe('getNextAvailableSlots', () => {
  it('returns empty if before reservation open time (5:45 AM PST)', () => {
    // 3:00 AM PST Jan 15 = 11:00 UTC — before 5:45 AM PST (13:45 UTC)
    const now = new Date('2026-01-15T11:00:00Z');
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result).toEqual([]);
  });

  it('returns available future slots after open time', () => {
    // 7:30 AM PST Jan 15 = 15:30 UTC — after open time, all three slots (8, 9, 10 AM) are future
    const now = new Date('2026-01-15T15:30:00Z');
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.length).toBe(3);
    expect(result[0].chargerId).toBe('C1');
  });

  it('excludes slots with reservation conflicts', () => {
    // 7:30 AM PST Jan 15 = 15:30 UTC
    const now = new Date('2026-01-15T15:30:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-01-15T17:00:00Z'), // 9:00 AM PST
      endTime: new Date('2026-01-15T18:00:00Z'),   // 10:00 AM PST
    });
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [res],
      configMap: DEFAULT_CONFIG,
    });
    // 9:00 AM slot is reserved; gap minutes may also block adjacent slots
    expect(result.length).toBeLessThan(3);
  });

  it('excludes past slots', () => {
    // 9:30 AM PST Jan 15 = 17:30 UTC — 8:00 and 9:00 AM are past, only 10:00 AM is future
    const now = new Date('2026-01-15T17:30:00Z');
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.length).toBe(1);
    // The start time should be 10:00 AM PST Jan 15 = 18:00 UTC
    expect(result[0].startTime).toBe('2026-01-15T18:00:00.000Z');
  });

  it('respects limit and offset', () => {
    // 7:30 AM PST Jan 15 = 15:30 UTC
    const now = new Date('2026-01-15T15:30:00Z');
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
      limit: 1,
      offset: 0,
    });
    expect(result.length).toBe(1);

    const result2 = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
      limit: 1,
      offset: 1,
    });
    expect(result2.length).toBe(1);
    expect(result2[0].startTime).not.toBe(result[0].startTime);
  });
});

// ---------------------------------------------------------------------------
// buildTimelineForCharger
// ---------------------------------------------------------------------------

// Use noon UTC Jan 15 = 4 AM PST — unambiguously Jan 15 in Pacific.
// Reserved slot: 9:00 AM PST = 17:00 UTC, end 10:00 AM PST = 18:00 UTC.

describe('buildTimelineForCharger', () => {
  it('builds timeline with all available slots', () => {
    const day = new Date('2026-01-15T12:00:00Z');
    const result = buildTimelineForCharger({
      charger: makeCharger(),
      day,
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.chargerId).toBe('C1');
    expect(result.blocks.length).toBe(3);
    expect(result.blocks.every((b) => b.status === 'available')).toBe(true);
  });

  it('marks reserved slots', () => {
    const day = new Date('2026-01-15T12:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-01-15T17:00:00Z'), // 9:00 AM PST
      endTime: new Date('2026-01-15T18:00:00Z'),   // 10:00 AM PST
    });
    const result = buildTimelineForCharger({
      charger: makeCharger(),
      day,
      reservations: [res],
      configMap: DEFAULT_CONFIG,
    });
    const reserved = result.blocks.filter((b) => b.status === 'reserved');
    expect(reserved.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty blocks for a zero-maxMinutes charger', () => {
    const day = new Date('2026-01-15T12:00:00Z');
    const result = buildTimelineForCharger({
      charger: makeCharger({ maxMinutes: 0 }),
      day,
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.blocks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCalendarDay
// ---------------------------------------------------------------------------

describe('buildCalendarDay', () => {
  it('counts total and available slots', () => {
    const day = new Date('2026-01-15T12:00:00Z');
    const result = buildCalendarDay({
      day,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.totalSlots).toBe(3);
    expect(result.availableSlots).toBe(3);
  });

  it('deducts reserved slots from available', () => {
    const day = new Date('2026-01-15T12:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-01-15T17:00:00Z'), // 9:00 AM PST
      endTime: new Date('2026-01-15T18:00:00Z'),   // 10:00 AM PST
    });
    const result = buildCalendarDay({
      day,
      chargers: [makeCharger()],
      reservations: [res],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.totalSlots).toBe(3);
    expect(result.availableSlots).toBeLessThan(3);
  });

  it('skips chargers with zero maxMinutes', () => {
    const day = new Date('2026-01-15T12:00:00Z');
    const result = buildCalendarDay({
      day,
      chargers: [makeCharger({ maxMinutes: 0 })],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.totalSlots).toBe(0);
    expect(result.availableSlots).toBe(0);
  });
});
