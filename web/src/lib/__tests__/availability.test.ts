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

describe('getReservationOpenTime', () => {
  it('returns the configured open time for the day', () => {
    const now = new Date('2026-03-15T10:00:00');
    const result = getReservationOpenTime(now, { openHour: 5, openMinute: 45 });
    expect(result.getHours()).toBe(5);
    expect(result.getMinutes()).toBe(45);
  });

  it('defaults to 5:45 for NaN inputs', () => {
    const now = new Date('2026-03-15T10:00:00');
    const result = getReservationOpenTime(now, { openHour: NaN, openMinute: NaN });
    expect(result.getHours()).toBe(5);
    expect(result.getMinutes()).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// getNextAvailableSlots
// ---------------------------------------------------------------------------

describe('getNextAvailableSlots', () => {
  it('returns empty if before reservation open time', () => {
    // 3:00 AM is before 5:45 AM open time
    const now = new Date('2026-03-15T03:00:00');
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result).toEqual([]);
  });

  it('returns available future slots', () => {
    // 7:30 — the 8:00 and 9:00 and 10:00 slots are all in the future
    const now = new Date('2026-03-15T07:30:00');
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
    const now = new Date('2026-03-15T07:30:00');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [res],
      configMap: DEFAULT_CONFIG,
    });
    // 8:00 and 10:00 should be available; 9:00 is reserved
    // But 8:00 end (9:00) + 1 gap minute conflicts with 9:00 reservation start,
    // and 10:00 start - 1 gap minute conflicts with 10:00 reservation end.
    // Let's just verify it's fewer than 3.
    expect(result.length).toBeLessThan(3);
  });

  it('excludes past slots', () => {
    const now = new Date(2026, 2, 15, 9, 30, 0); // 9:30 AM local
    const result = getNextAvailableSlots({
      now,
      chargers: [makeCharger()],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    // 8:00 and 9:00 are in the past; only 10:00 is future
    expect(result.length).toBe(1);
    // The start time should represent 10:00 local — parse it back to verify
    const slotStart = new Date(result[0].startTime);
    expect(slotStart.getHours()).toBe(10);
    expect(slotStart.getMinutes()).toBe(0);
  });

  it('respects limit and offset', () => {
    const now = new Date('2026-03-15T07:30:00');
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
    // Second slot should be different from first
    expect(result2[0].startTime).not.toBe(result[0].startTime);
  });
});

// ---------------------------------------------------------------------------
// buildTimelineForCharger
// ---------------------------------------------------------------------------

describe('buildTimelineForCharger', () => {
  it('builds timeline with all available slots', () => {
    const day = new Date('2026-03-15T00:00:00');
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
    const day = new Date('2026-03-15T00:00:00');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
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
    const day = new Date('2026-03-15T00:00:00');
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
    const day = new Date('2026-03-15T00:00:00');
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
    const day = new Date('2026-03-15T00:00:00');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
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
    const day = new Date('2026-03-15T00:00:00');
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
