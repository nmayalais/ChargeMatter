'use strict';

// Regression tests for two production bugs fixed 2026-04-29:
//   Bug #2 — wrong person shown as "currently booked" when a stale previous-slot
//             reservation remained active (first-found semantics picked wrong owner)
//   Bug #1 — board timezone returned as null before first successful loadBoard(),
//             causing toLocaleTimeString() to fall back to browser's local tz

const {
  createEngine,
  CHARGERS_HEADERS,
  SESSIONS_HEADERS,
  RESERVATIONS_HEADERS,
  STRIKES_HEADERS,
  SUSPENSIONS_HEADERS,
  CONFIG_HEADERS
} = require('../cli/engine');

// ─── helpers ────────────────────────────────────────────────────────────────

function buildStore(chargerRows) {
  return {
    properties: { SPREADSHEET_ID: 'local' },
    sheets: {
      chargers: {
        headers: CHARGERS_HEADERS,
        rows: chargerRows || [
          ['1', 'Charger 1', 60, '06:00,07:00,08:00', '']
        ]
      },
      sessions: { headers: SESSIONS_HEADERS, rows: [] },
      reservations: { headers: RESERVATIONS_HEADERS, rows: [] },
      strikes: { headers: STRIKES_HEADERS, rows: [] },
      suspensions: { headers: SUSPENSIONS_HEADERS, rows: [] },
      config: {
        headers: CONFIG_HEADERS,
        rows: [
          ['allowed_domain', 'example.com'],
          ['admin_emails', 'admin@example.com']
        ]
      }
    }
  };
}

function createUserEngine(store, email = 'alice@example.com') {
  return createEngine({ store, authEmail: email, authName: 'Alice', isAdmin: false });
}

function localDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// Set wall-clock time, run fn(), restore real timers.
function withLocalTime(year, month, day, hour, minute, fn) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(year, month - 1, day, hour, minute, 0, 0));
  try {
    fn();
  } finally {
    jest.useRealTimers();
  }
}

// Build a full RESERVATIONS_HEADERS-length row.
function makeReservationRow(overrides = {}) {
  const defaults = {
    reservation_id: 'res-1',
    charger_id: '1',
    user_id: 'alice@example.com',
    user_name: 'Alice',
    start_time: localDate(2026, 4, 1, 8, 0),
    end_time:   localDate(2026, 4, 1, 9, 0),
    status: 'active',
    checked_in_at: '',
    no_show_at: '',
    no_show_strike_at: '',
    reminder_5_before_sent: '',
    reminder_5_after_sent: '',
    created_at: localDate(2026, 4, 1, 7, 0),
    updated_at: '',
    canceled_at: '',
    released_early: ''
  };
  const r = Object.assign({}, defaults, overrides);
  return [
    r.reservation_id, r.charger_id, r.user_id, r.user_name,
    r.start_time, r.end_time, r.status, r.checked_in_at,
    r.no_show_at, r.no_show_strike_at, r.reminder_5_before_sent,
    r.reminder_5_after_sent, r.created_at, r.updated_at,
    r.canceled_at, r.released_early
  ];
}

// ─── Bug #2: active reservation picks earliest-starting slot ─────────────────

describe('groupReservationsByCharger_ — active slot selection (Bug #2 regression)', () => {
  // Scenario: now = 08:30. Stale 07:00–08:00 slot still has status 'active'
  // AND the current 08:00–09:00 slot also has status 'active'.
  // Both satisfy now >= start && now < end? No — stale slot already ended at 08:00.
  // More realistic scenario: cron hasn't run yet, stale slot end_time extended or
  // the stale slot's window still overlaps if now=07:30 and there are two slots with
  // startTimes 06:30 (stale) and 07:00 (current) both ending at 08:00.
  //
  // Simpler determinism test: two active-window reservations on the same charger
  // (e.g. overlapping windows due to rescheduling) — earliest-start must win.

  test('when two reservations overlap the current window, picks the one with the earlier start', () => {
    const store = buildStore();
    // now = 08:15 → both rows overlap [08:00,09:00) and [07:00,09:00)
    // Bob has start 07:00, Alice has start 08:00. Bob (earlier) must win.
    store.sheets.reservations.rows.push(
      makeReservationRow({
        reservation_id: 'res-alice',
        user_id: 'alice@example.com',
        user_name: 'Alice',
        start_time: localDate(2026, 4, 1, 8, 0),
        end_time:   localDate(2026, 4, 1, 9, 0)
      }),
      makeReservationRow({
        reservation_id: 'res-bob',
        user_id: 'bob@example.com',
        user_name: 'Bob',
        start_time: localDate(2026, 4, 1, 7, 0),
        end_time:   localDate(2026, 4, 1, 9, 0)
      })
    );

    let result;
    withLocalTime(2026, 4, 1, 8, 15, () => {
      const engine = createUserEngine(store);
      result = engine.getBoardData();
    });

    const charger = result.chargers.find((c) => c.id === '1');
    expect(charger).toBeDefined();
    // Bob's reservation (earlier start) must be the active one shown
    expect(charger.reservation).not.toBeNull();
    expect(charger.reservation.userEmail).toBe('bob@example.com');
  });

  test('result is the same regardless of the order rows appear in the store (array-order determinism)', () => {
    // Insert rows in reversed order (Bob first, then Alice) — result must be identical
    const store = buildStore();
    store.sheets.reservations.rows.push(
      makeReservationRow({
        reservation_id: 'res-bob',
        user_id: 'bob@example.com',
        user_name: 'Bob',
        start_time: localDate(2026, 4, 1, 7, 0),
        end_time:   localDate(2026, 4, 1, 9, 0)
      }),
      makeReservationRow({
        reservation_id: 'res-alice',
        user_id: 'alice@example.com',
        user_name: 'Alice',
        start_time: localDate(2026, 4, 1, 8, 0),
        end_time:   localDate(2026, 4, 1, 9, 0)
      })
    );

    let result;
    withLocalTime(2026, 4, 1, 8, 15, () => {
      const engine = createUserEngine(store);
      result = engine.getBoardData();
    });

    const charger = result.chargers.find((c) => c.id === '1');
    expect(charger.reservation.userEmail).toBe('bob@example.com');
  });

  test('stale previous slot (status active, window already passed) does not displace current occupant', () => {
    // now = 08:30. Stale slot: 06:00–07:00 still shows status=active (cron missed it).
    // Current slot: 08:00–09:00. Only the current slot's window overlaps now.
    const store = buildStore();
    store.sheets.reservations.rows.push(
      makeReservationRow({
        reservation_id: 'res-stale',
        user_id: 'carol@example.com',
        user_name: 'Carol',
        start_time: localDate(2026, 4, 1, 6, 0),
        end_time:   localDate(2026, 4, 1, 7, 0),
        status: 'active'
      }),
      makeReservationRow({
        reservation_id: 'res-current',
        user_id: 'alice@example.com',
        user_name: 'Alice',
        start_time: localDate(2026, 4, 1, 8, 0),
        end_time:   localDate(2026, 4, 1, 9, 0),
        status: 'active'
      })
    );

    let result;
    withLocalTime(2026, 4, 1, 8, 30, () => {
      const engine = createUserEngine(store);
      result = engine.getBoardData();
    });

    const charger = result.chargers.find((c) => c.id === '1');
    expect(charger.reservation).not.toBeNull();
    // Stale slot window ended at 07:00 — should be invisible at 08:30
    expect(charger.reservation.userEmail).toBe('alice@example.com');
  });

  test('next reservation shows the soonest upcoming slot, not the latest', () => {
    // now = 06:00. Two future slots: 08:00 and 10:00. Board should surface 08:00.
    const store = buildStore();
    store.sheets.reservations.rows.push(
      makeReservationRow({
        reservation_id: 'res-later',
        user_id: 'bob@example.com',
        user_name: 'Bob',
        start_time: localDate(2026, 4, 1, 10, 0),
        end_time:   localDate(2026, 4, 1, 11, 0)
      }),
      makeReservationRow({
        reservation_id: 'res-sooner',
        user_id: 'alice@example.com',
        user_name: 'Alice',
        start_time: localDate(2026, 4, 1, 8, 0),
        end_time:   localDate(2026, 4, 1, 9, 0)
      })
    );

    let result;
    withLocalTime(2026, 4, 1, 6, 0, () => {
      const engine = createUserEngine(store);
      result = engine.getBoardData();
    });

    const charger = result.chargers.find((c) => c.id === '1');
    // No active reservation yet; next should be the 08:00 slot
    expect(charger.reservation).toBeNull();
    expect(charger.nextReservation).not.toBeNull();
    expect(charger.nextReservation.userEmail).toBe('alice@example.com');
  });
});

// ─── Bug #1: board response always includes a hardcoded timezone ──────────────

describe('getBoardData timezone field (Bug #1 regression)', () => {
  test('getBoardData always returns America/Los_Angeles as timezone', () => {
    const store = buildStore();
    let result;
    withLocalTime(2026, 4, 1, 8, 0, () => {
      const engine = createUserEngine(store);
      result = engine.getBoardData();
    });
    expect(result.timezone).toBe('America/Los_Angeles');
  });

  test('timezone field is never null or undefined', () => {
    const store = buildStore();
    let result;
    withLocalTime(2026, 4, 1, 8, 0, () => {
      const engine = createUserEngine(store);
      result = engine.getBoardData();
    });
    expect(result.timezone).toBeTruthy();
  });
});
