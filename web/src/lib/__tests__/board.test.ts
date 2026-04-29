import { describe, it, expect, vi } from 'vitest';

// Mock the db module to avoid requiring DATABASE_URL
vi.mock('@/lib/db', () => ({
  db: { select: vi.fn() },
}));

import {
  buildBoard,
  groupReservationsByCharger,
  findReservationForSlot,
  isNetNewUser,
  isReturningUser,
} from '@/lib/board';
import type { Charger, Session, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Factory helpers — produce minimal typed objects for testing
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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'S1',
    chargerId: 'C1',
    userId: 'user@example.com',
    userName: 'User',
    startTime: new Date('2026-03-15T08:00:00Z'),
    endTime: new Date('2026-03-15T09:00:00Z'),
    status: 'active',
    active: true,
    overdue: false,
    complete: false,
    reminder10Sent: false,
    reminder5Sent: false,
    reminder0Sent: false,
    overdueLastSentAt: null,
    graceNotifiedAt: null,
    lateStrikeAt: null,
    endedAt: null,
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
  app_name: 'EV Charging',
  slack_channel_name: 'ev-charging',
  slack_channel_url: '',
  overdue_repeat_minutes: '15',
  session_move_grace_minutes: '10',
  suspension_business_days: '2',
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
// groupReservationsByCharger
// ---------------------------------------------------------------------------

describe('groupReservationsByCharger', () => {
  it('returns empty groups when no reservations', () => {
    const result = groupReservationsByCharger([], new Date());
    expect(result.active).toEqual({});
    expect(result.next).toEqual({});
  });

  it('classifies an active reservation', () => {
    const now = new Date('2026-03-15T09:30:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = groupReservationsByCharger([res], now);
    expect(result.active['C1']).toBe(res);
    expect(result.next['C1']).toBeUndefined();
  });

  it('classifies a future reservation as next', () => {
    const now = new Date('2026-03-15T08:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = groupReservationsByCharger([res], now);
    expect(result.next['C1']).toBe(res);
    expect(result.active['C1']).toBeUndefined();
  });

  it('picks the soonest future reservation as next', () => {
    const now = new Date('2026-03-15T07:00:00Z');
    const res1 = makeReservation({
      id: 'R1',
      chargerId: 'C1',
      startTime: new Date('2026-03-15T10:00:00Z'),
      endTime: new Date('2026-03-15T11:00:00Z'),
    });
    const res2 = makeReservation({
      id: 'R2',
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = groupReservationsByCharger([res1, res2], now);
    expect(result.next['C1']!.id).toBe('R2');
  });

  it('skips canceled/no-show/complete reservations', () => {
    const now = new Date('2026-03-15T09:30:00Z');
    const canceled = makeReservation({ status: 'canceled', canceledAt: new Date() });
    const noShow = makeReservation({ id: 'R2', status: 'no_show', noShowAt: new Date() });
    const complete = makeReservation({ id: 'R3', status: 'complete' });
    const result = groupReservationsByCharger([canceled, noShow, complete], now);
    expect(result.active).toEqual({});
    expect(result.next).toEqual({});
  });

  // --- Regression: Bug #2 — active selection is deterministic regardless of array order ---

  it('picks the current-slot reservation regardless of array order (regression: wrong person shown)', () => {
    // 10:00 AM PDT = 17:00 UTC — midway through slot A (9:00–10:30 AM PDT)
    const now = new Date('2026-04-29T17:00:00Z');
    const slotA = makeReservation({
      id: 'R-current',
      chargerId: 'C1',
      userId: 'person-a@test.com',
      startTime: new Date('2026-04-29T16:00:00Z'), // 9:00 AM PDT
      endTime: new Date('2026-04-29T17:30:00Z'),   // 10:30 AM PDT
    });
    const slotB = makeReservation({
      id: 'R-next',
      chargerId: 'C1',
      userId: 'person-b@test.com',
      startTime: new Date('2026-04-29T17:30:00Z'), // 10:30 AM PDT
      endTime: new Date('2026-04-29T19:00:00Z'),   // 12:00 PM PDT
    });

    // Array order: next before current — must still pick current
    const result1 = groupReservationsByCharger([slotB, slotA], now);
    expect(result1.active['C1']!.userId).toBe('person-a@test.com');
    expect(result1.next['C1']!.userId).toBe('person-b@test.com');

    // Array order: current before next — same result
    const result2 = groupReservationsByCharger([slotA, slotB], now);
    expect(result2.active['C1']!.userId).toBe('person-a@test.com');
    expect(result2.next['C1']!.userId).toBe('person-b@test.com');
  });

  it('when two reservations overlap in active window, picks the earlier-starting one', () => {
    // Simulates a cron failure leaving the previous slot unprocessed (still status=active past endTime)
    // now = 9:30 AM PDT = 16:30 UTC
    const now = new Date('2026-04-29T16:30:00Z');
    const stale = makeReservation({
      id: 'R-stale',
      chargerId: 'C1',
      userId: 'stale-person@test.com',
      startTime: new Date('2026-04-29T15:00:00Z'), // 8:00 AM PDT — older slot, cron missed
      endTime: new Date('2026-04-29T17:00:00Z'),   // 10:00 AM PDT (past nominal end but still active)
    });
    const current = makeReservation({
      id: 'R-current',
      chargerId: 'C1',
      userId: 'current-person@test.com',
      startTime: new Date('2026-04-29T16:00:00Z'), // 9:00 AM PDT — the real current slot
      endTime: new Date('2026-04-29T17:30:00Z'),   // 10:30 AM PDT
    });

    // Both satisfy now >= startTime && now < endTime — earliest start (stale) should win
    const result1 = groupReservationsByCharger([current, stale], now);
    expect(result1.active['C1']!.userId).toBe('stale-person@test.com');

    const result2 = groupReservationsByCharger([stale, current], now);
    expect(result2.active['C1']!.userId).toBe('stale-person@test.com');
  });

  it('does not classify the previous slot as active at the exact slot boundary', () => {
    // now === slot1.endTime === slot2.startTime: slot1 must NOT be active, slot2 MUST be active
    const boundary = new Date('2026-04-29T17:30:00Z'); // 10:30 AM PDT
    const slot1 = makeReservation({
      id: 'R1',
      chargerId: 'C1',
      userId: 'person-a@test.com',
      startTime: new Date('2026-04-29T16:00:00Z'), // 9:00 AM PDT
      endTime: boundary,                            // ends exactly at boundary
    });
    const slot2 = makeReservation({
      id: 'R2',
      chargerId: 'C1',
      userId: 'person-b@test.com',
      startTime: boundary,                          // starts exactly at boundary
      endTime: new Date('2026-04-29T19:00:00Z'),   // 12:00 PM PDT
    });

    const result = groupReservationsByCharger([slot1, slot2], boundary);
    expect(result.active['C1']!.userId).toBe('person-b@test.com');
  });
});

// ---------------------------------------------------------------------------
// findReservationForSlot
// ---------------------------------------------------------------------------

describe('findReservationForSlot', () => {
  it('finds a reservation matching the slot start', () => {
    const slotStart = new Date('2026-03-15T09:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: new Date('2026-03-15T09:00:00Z'),
    });
    expect(findReservationForSlot([res], 'C1', slotStart)).toBe(res);
  });

  it('returns null when no matching reservation', () => {
    const slotStart = new Date('2026-03-15T11:00:00Z');
    const res = makeReservation({ chargerId: 'C1' });
    expect(findReservationForSlot([res], 'C1', slotStart)).toBeNull();
  });

  it('skips canceled reservations', () => {
    const slotStart = new Date('2026-03-15T09:00:00Z');
    const res = makeReservation({
      chargerId: 'C1',
      startTime: slotStart,
      status: 'canceled',
      canceledAt: new Date(),
    });
    expect(findReservationForSlot([res], 'C1', slotStart)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildBoard
// ---------------------------------------------------------------------------

describe('buildBoard', () => {
  it('builds an empty board with no sessions/reservations', () => {
    // Use a time within the 8:00 slot (local time)
    const now = new Date('2026-03-15T15:30:00Z'); // March 15, 2026 8:30 AM PDT
    const charger = makeCharger();
    const result = buildBoard({
      now,
      chargers: [charger],
      sessions: [],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.chargers).toHaveLength(1);
    expect(result.chargers[0].id).toBe('C1');
    expect(result.chargers[0].statusKey).toBe('free');
    expect(result.chargers[0].status).toBe('Open');
    expect(result.chargers[0].session).toBeNull();
    expect(result.chargers[0].reservation).toBeNull();
    // Should have walkup info since we're within a slot (8:00-9:00 local)
    expect(result.chargers[0].walkup).not.toBeNull();
  });

  it('shows a charger as in_use when it has an active session', () => {
    const now = new Date('2026-03-15T08:30:00Z');
    const charger = makeCharger({ activeSessionId: 'S1' });
    const session = makeSession({
      startTime: new Date('2026-03-15T08:00:00Z'),
      endTime: new Date('2026-03-15T09:00:00Z'),
    });
    const result = buildBoard({
      now,
      chargers: [charger],
      sessions: [session],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.chargers[0].statusKey).toBe('in_use');
    expect(result.chargers[0].status).toBe('In use');
    expect(result.chargers[0].session).not.toBeNull();
    expect(result.chargers[0].session!.sessionId).toBe('S1');
  });

  it('shows a charger as overdue when session is past grace period', () => {
    // Session ended at 09:00, grace=10min, now=09:15 => overdue
    const now = new Date('2026-03-15T09:15:00Z');
    const charger = makeCharger({ activeSessionId: 'S1' });
    const session = makeSession({
      startTime: new Date('2026-03-15T08:00:00Z'),
      endTime: new Date('2026-03-15T09:00:00Z'),
    });
    const result = buildBoard({
      now,
      chargers: [charger],
      sessions: [session],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.chargers[0].statusKey).toBe('overdue');
    expect(result.chargers[0].status).toBe('Overdue');
  });

  it('shows a charger as reserved when it has an active reservation', () => {
    const now = new Date('2026-03-15T09:30:00Z');
    const charger = makeCharger();
    const res = makeReservation({
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = buildBoard({
      now,
      chargers: [charger],
      sessions: [],
      reservations: [res],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.chargers[0].statusKey).toBe('reserved');
    expect(result.chargers[0].status).toBe('Reserved');
    expect(result.chargers[0].reservation).not.toBeNull();
  });

  it('ignores a complete session on the charger', () => {
    const now = new Date('2026-03-15T08:30:00Z');
    const charger = makeCharger({ activeSessionId: 'S1' });
    const session = makeSession({ complete: true, status: 'complete' });
    const result = buildBoard({
      now,
      chargers: [charger],
      sessions: [session],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    // Should be free since the session is complete
    expect(result.chargers[0].statusKey).toBe('free');
    expect(result.chargers[0].session).toBeNull();
  });

  it('includes config values in the result', () => {
    const now = new Date('2026-03-15T08:00:00Z');
    const result = buildBoard({
      now,
      chargers: [],
      sessions: [],
      reservations: [],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.config.appName).toBe('EV Charging');
    expect(result.config.reservationLateGraceMinutes).toBe(30);
    expect(result.config.walkupNetNewWindowMinutes).toBe(10);
  });

  it('populates nextReservation for a charger', () => {
    const now = new Date('2026-03-15T07:00:00Z');
    const charger = makeCharger();
    const res = makeReservation({
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = buildBoard({
      now,
      chargers: [charger],
      sessions: [],
      reservations: [res],
      configMap: DEFAULT_CONFIG,
    });
    expect(result.chargers[0].statusKey).toBe('free');
    expect(result.chargers[0].nextReservation).not.toBeNull();
    expect(result.chargers[0].nextReservation!.reservationId).toBe('R1');
  });
});

// ---------------------------------------------------------------------------
// isNetNewUser
// ---------------------------------------------------------------------------

describe('isNetNewUser', () => {
  const now = new Date('2026-03-15T10:00:00Z');

  it('returns true for a user with no sessions or reservations today', () => {
    expect(isNetNewUser('user@example.com', [], [], now)).toBe(true);
  });

  it('returns false if the user has a session today', () => {
    const session = makeSession({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T08:00:00Z'),
    });
    expect(isNetNewUser('user@example.com', [session], [], now)).toBe(false);
  });

  it('returns true if the session is from an early-released reservation', () => {
    const session = makeSession({
      userId: 'user@example.com',
      chargerId: 'C1',
      startTime: new Date('2026-03-15T08:00:00Z'),
      endTime: new Date('2026-03-15T08:20:00Z'),
    });
    const res = makeReservation({
      userId: 'user@example.com',
      chargerId: 'C1',
      startTime: new Date('2026-03-15T08:00:00Z'),
      endTime: new Date('2026-03-15T09:00:00Z'),
      status: 'complete',
      releasedEarly: true,
    });
    expect(isNetNewUser('user@example.com', [session], [res], now)).toBe(true);
  });

  it('returns false if the user has an active reservation today', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T10:00:00Z'),
      endTime: new Date('2026-03-15T11:00:00Z'),
    });
    expect(isNetNewUser('user@example.com', [], [res], now)).toBe(false);
  });

  it('returns true if the only reservation today was canceled early', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T10:00:00Z'),
      endTime: new Date('2026-03-15T11:00:00Z'),
      status: 'canceled',
      canceledAt: new Date('2026-03-15T10:10:00Z'), // before halfway (10:30)
    });
    expect(isNetNewUser('user@example.com', [], [res], now)).toBe(true);
  });

  it('returns false if the reservation was canceled late', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T10:00:00Z'),
      endTime: new Date('2026-03-15T11:00:00Z'),
      status: 'canceled',
      canceledAt: new Date('2026-03-15T10:40:00Z'), // after halfway (10:30)
    });
    expect(isNetNewUser('user@example.com', [], [res], now)).toBe(false);
  });

  it('is case-insensitive on email', () => {
    const session = makeSession({
      userId: 'User@Example.com',
      startTime: new Date('2026-03-15T08:00:00Z'),
    });
    expect(isNetNewUser('user@example.com', [session], [], now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReturningUser
// ---------------------------------------------------------------------------

describe('isReturningUser', () => {
  const now = new Date('2026-03-15T10:00:00Z');

  it('returns false for a user with no activity today', () => {
    expect(isReturningUser('user@example.com', [], [], now)).toBe(false);
  });

  it('returns true if the user has a session today', () => {
    const session = makeSession({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T08:00:00Z'),
    });
    expect(isReturningUser('user@example.com', [session], [], now)).toBe(true);
  });

  it('returns false if the session is from an early-released reservation', () => {
    const session = makeSession({
      userId: 'user@example.com',
      chargerId: 'C1',
      startTime: new Date('2026-03-15T08:00:00Z'),
      endTime: new Date('2026-03-15T08:20:00Z'),
    });
    const res = makeReservation({
      userId: 'user@example.com',
      chargerId: 'C1',
      startTime: new Date('2026-03-15T08:00:00Z'),
      endTime: new Date('2026-03-15T09:00:00Z'),
      status: 'complete',
      releasedEarly: true,
    });
    expect(isReturningUser('user@example.com', [session], [res], now)).toBe(false);
  });

  it('returns true if the user has a no-show reservation today', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T08:00:00Z'),
      status: 'no_show',
      noShowAt: new Date('2026-03-15T08:30:00Z'),
    });
    expect(isReturningUser('user@example.com', [], [res], now)).toBe(true);
  });

  it('returns true for a completed reservation (not early-released)', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T08:00:00Z'),
      status: 'complete',
      releasedEarly: false,
    });
    expect(isReturningUser('user@example.com', [], [res], now)).toBe(true);
  });

  it('returns false for an early-released completed reservation', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T08:00:00Z'),
      status: 'complete',
      releasedEarly: true,
    });
    expect(isReturningUser('user@example.com', [], [res], now)).toBe(false);
  });
});
