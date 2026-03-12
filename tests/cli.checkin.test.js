'use strict';

const {
  createEngine,
  CHARGERS_HEADERS,
  SESSIONS_HEADERS,
  RESERVATIONS_HEADERS,
  STRIKES_HEADERS,
  SUSPENSIONS_HEADERS,
  CONFIG_HEADERS
} = require('../cli/engine');

// ---------------------------------------------------------------------------
// Store / engine helpers
// ---------------------------------------------------------------------------

function buildStore() {
  return {
    properties: { SPREADSHEET_ID: 'local' },
    sheets: {
      chargers: {
        headers: CHARGERS_HEADERS,
        rows: [
          // Charger 1: 60-min slots starting on the hour 6–10 AM
          ['1', 'Charger 1', 60, '06:00,07:00,08:00,09:00,10:00', ''],
          // Charger 2: same config, used for cross-charger tests
          ['2', 'Charger 2', 60, '06:00,07:00,08:00,09:00,10:00', '']
        ]
      },
      sessions: {
        headers: SESSIONS_HEADERS,
        rows: []
      },
      reservations: {
        headers: RESERVATIONS_HEADERS,
        rows: []
      },
      strikes: {
        headers: STRIKES_HEADERS,
        rows: []
      },
      suspensions: {
        headers: SUSPENSIONS_HEADERS,
        rows: []
      },
      config: {
        headers: CONFIG_HEADERS,
        rows: [
          ['allowed_domain', 'example.com'],
          ['admin_emails', 'admin@example.com'],
          ['reservation_early_start_minutes', '15'],
          ['reservation_late_grace_minutes', '30'],
          ['session_move_grace_minutes', '10']
        ]
      }
    }
  };
}

function createUserEngine(store, email = 'driver@example.com') {
  return createEngine({ store, authEmail: email, authName: 'Driver', isAdmin: false });
}

function createAdminEngine(store) {
  return createEngine({ store, authEmail: 'admin@example.com', authName: 'Admin', isAdmin: true });
}

// Control wall-clock time for the duration of fn()
function withLocalTime(year, month, day, hour, minute, fn) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(year, month - 1, day, hour, minute, 0, 0));
  try {
    fn();
  } finally {
    jest.useRealTimers();
  }
}

// Shorthand for building a Date in local time
function localDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// Push a reservation row into the store.
// Defaults: charger 1, driver@example.com, 8:00–9:00 AM on 2026-03-10, status 'active'
function pushReservation(store, overrides = {}) {
  const id = overrides.id || 'res-1';
  const chargerId = overrides.chargerId || '1';
  const userId = overrides.userId || 'driver@example.com';
  const start = overrides.start || localDate(2026, 3, 10, 8, 0);
  const end = overrides.end || localDate(2026, 3, 10, 9, 0);
  const status = overrides.status || 'active';
  const checkedInAt = overrides.checkedInAt || '';

  store.sheets.reservations.rows.push([
    id, chargerId, userId, 'Driver',
    start, end, status, checkedInAt,
    '', '', '', '',
    start, start, '', ''
  ]);
  return id;
}

// Push an active session row into the store
function pushSession(store, overrides = {}) {
  const id = overrides.id || 'session-1';
  const chargerId = overrides.chargerId || '1';
  const userId = overrides.userId || 'driver@example.com';
  const start = overrides.start || localDate(2026, 3, 10, 8, 0);
  const end = overrides.end || localDate(2026, 3, 10, 9, 0);

  store.sheets.sessions.rows.push([
    id, chargerId, userId, 'Driver',
    start, end, 'active', true, false, false,
    false, false, false, '', '', '', ''
  ]);

  // Mark the charger as occupied
  const chargerRow = store.sheets.chargers.rows.find((r) => String(r[0]) === String(chargerId));
  if (chargerRow) chargerRow[4] = id;

  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkInReservation', () => {

  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  describe('on-time check-in (now >= reservation start)', () => {
    test('succeeds when called at the reservation start time', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 0, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });

    test('succeeds when called shortly after reservation start', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 10, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });

    test('stamps reservation as checked_in after on-time check-in', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        engine.checkInReservation(resId);
      });

      const resRow = store.sheets.reservations.rows.find((r) => r[0] === resId);
      expect(resRow[6]).toBe('checked_in');   // status column
      expect(resRow[7]).toBeTruthy();          // checked_in_at column
    });

    test('creates an active session on the correct charger after on-time check-in', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        engine.checkInReservation(resId);
      });

      const session = store.sheets.sessions.rows.find(
        (r) => r[2] === 'driver@example.com' && r[6] === 'active'
      );
      expect(session).toBeTruthy();
      expect(String(session[1])).toBe('1'); // charger_id
    });

    test('updates charger active_session_id after on-time check-in', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        engine.checkInReservation(resId);
      });

      const chargerRow = store.sheets.chargers.rows.find((r) => r[0] === '1');
      expect(chargerRow[4]).toBeTruthy(); // active_session_id set
    });
  });

  describe('early check-in (now < reservation start, within earlyStartMinutes window)', () => {
    test('succeeds when called within the early window', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      // 10 min before start; earlyStartMinutes default = 15, so within window
      withLocalTime(2026, 3, 10, 7, 50, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });

    test('early check-in uses reservation end_time for session end', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 7, 50, () => {
        engine.checkInReservation(resId);
      });

      const session = store.sheets.sessions.rows.find(
        (r) => r[2] === 'driver@example.com' && r[6] === 'active'
      );
      expect(session).toBeTruthy();
      // end_time should match the reservation's end_time (9:00 AM)
      const sessionEnd = session[5];
      expect(new Date(sessionEnd).getHours()).toBe(9);
      expect(new Date(sessionEnd).getMinutes()).toBe(0);
    });

    test('stamps reservation as checked_in after early check-in', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 7, 50, () => {
        engine.checkInReservation(resId);
      });

      const resRow = store.sheets.reservations.rows.find((r) => r[0] === resId);
      expect(resRow[6]).toBe('checked_in');
      expect(resRow[7]).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Timing boundary enforcement
  // -------------------------------------------------------------------------

  describe('timing boundaries', () => {
    test('rejects check-in before the early window opens', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      // 20 min before start; earlyStartMinutes = 15 → too early
      withLocalTime(2026, 3, 10, 7, 40, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('Check-in opens at');
      });
    });

    test('rejects check-in after the late grace window expires', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      // 31 min after start; lateGraceMinutes = 30 → expired
      withLocalTime(2026, 3, 10, 8, 31, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('too late to check in');
      });
    });

    test('allows check-in at exactly the earliest boundary', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      // Exactly 15 min before start = earliest allowed
      withLocalTime(2026, 3, 10, 7, 45, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });

    test('allows check-in at exactly the late grace boundary', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      // Exactly 30 min after start = edge of allowed window
      withLocalTime(2026, 3, 10, 8, 30, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    test('rejects check-in by a different user', () => {
      const store = buildStore();
      const resId = pushReservation(store); // owned by driver@example.com
      const engine = createUserEngine(store, 'other@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('own reservation');
      });
    });

    test('admin can check in to another user\'s reservation', () => {
      const store = buildStore();
      const resId = pushReservation(store); // owned by driver@example.com
      const engine = createAdminEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });

    test('email comparison is case-insensitive', () => {
      const store = buildStore();
      const resId = pushReservation(store, { userId: 'Driver@Example.COM' });
      const engine = createUserEngine(store, 'driver@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Reservation state guards
  // -------------------------------------------------------------------------

  describe('reservation state guards', () => {
    test('rejects check-in with unknown reservation id', () => {
      const store = buildStore();
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation('does-not-exist')).toThrow('Reservation not found');
      });
    });

    test('rejects check-in on a canceled reservation', () => {
      const store = buildStore();
      const resId = pushReservation(store, { status: 'canceled' });
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('Reservation not found');
      });
    });

    test('rejects check-in on a no_show reservation', () => {
      const store = buildStore();
      const resId = pushReservation(store, { status: 'no_show' });
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('Reservation not found');
      });
    });

    test('rejects check-in on a complete reservation', () => {
      const store = buildStore();
      const resId = pushReservation(store, { status: 'complete' });
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('Reservation not found');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Active session conflict
  // -------------------------------------------------------------------------

  describe('active session conflict', () => {
    test('rejects check-in when user already has an active session on a different charger', () => {
      const store = buildStore();
      const resId = pushReservation(store, { chargerId: '1' });
      // Pre-seed an active session on charger 2 for the same user
      pushSession(store, { id: 'existing-session', chargerId: '2' });
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('already have an active session');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Suspended user
  // -------------------------------------------------------------------------

  describe('suspended user', () => {
    test('rejects check-in when user is suspended', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      // Add an active suspension for the user
      store.sheets.suspensions.rows.push([
        'susp-1', 'driver@example.com', 'Driver',
        localDate(2026, 3, 9, 0, 0),
        localDate(2026, 3, 11, 23, 59),
        'no-show strikes', true,
        localDate(2026, 3, 9, 0, 0)
      ]);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Early check-in error cases (startSessionForReservation_ path)
  // -------------------------------------------------------------------------

  describe('early check-in error cases', () => {
    test('rejects early check-in when charger is already in use', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      // Charger 1 has an ongoing session that hasn't ended yet
      pushSession(store, {
        id: 'ongoing-session',
        chargerId: '1',
        userId: 'other@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)  // ends exactly at reservation start
      });
      const engine = createUserEngine(store);

      // Check in 10 min early (still in early window)
      withLocalTime(2026, 3, 10, 7, 50, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('already in use');
      });
    });

    test('rejects early check-in when previous reservation is still within its grace window', () => {
      // To get overlap between the early-check-in window and the previous reservation's
      // grace window we need earlyStartMinutes > lateGraceMinutes. Here we use
      // earlyStartMinutes=45, lateGraceMinutes=30:
      //   previous reservation  7:00 AM → grace window 7:00–7:30 AM
      //   my reservation        8:00 AM → early window opens at 7:15 AM (8:00 − 45 min)
      //   check-in at 7:20 AM  → inside early window AND inside previous grace → blocked
      const store = buildStore();
      // Override early start minutes to 45 for this test
      store.sheets.config.rows.push(['reservation_early_start_minutes', '45']);

      pushReservation(store, {
        id: 'prev-res',
        chargerId: '1',
        userId: 'other@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0),
        status: 'active'
      });
      const resId = pushReservation(store, {
        id: 'my-res',
        chargerId: '1',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store);

      // 7:20 AM: within early window (opens 7:15) and within previous grace (ends 7:30)
      withLocalTime(2026, 3, 10, 7, 20, () => {
        expect(() => engine.checkInReservation(resId)).toThrow('Previous reservation');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Double check-in / idempotency
  // -------------------------------------------------------------------------

  describe('double check-in', () => {
    test('second check-in attempt throws because user already has an active session', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        engine.checkInReservation(resId); // first check-in — starts a session
        // Second attempt: user now has an active session
        expect(() => engine.checkInReservation(resId)).toThrow('already have an active session');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Return value
  // -------------------------------------------------------------------------

  describe('return value', () => {
    test('returns board data after successful check-in', () => {
      const store = buildStore();
      const resId = pushReservation(store);
      const engine = createUserEngine(store);

      let result;
      withLocalTime(2026, 3, 10, 8, 5, () => {
        result = engine.checkInReservation(resId);
      });

      expect(result).toBeTruthy();
      expect(result.chargers).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Force-end overdue session on check-in
  // -------------------------------------------------------------------------

  describe('force-end overdue session on check-in', () => {

    test('happy path: overdue session is force-ended and check-in succeeds', () => {
      const store = buildStore();
      // Person A: active session 7:00–8:00 on Charger 1
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      // Person B: reservation 8:00–9:00 on Charger 1
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });

      // Person A's session should be complete with ended_at set
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('complete');   // status
      expect(sessionA[9]).toBe(true);         // complete flag
      expect(sessionA[16]).toBeTruthy();      // ended_at

      // Person B should have a new active session
      const sessionB = store.sheets.sessions.rows.find(
        (r) => r[2] === 'personb@example.com' && r[6] === 'active'
      );
      expect(sessionB).toBeTruthy();
      expect(String(sessionB[1])).toBe('1');  // charger_id

      // Person B's reservation should be checked_in
      const resRow = store.sheets.reservations.rows.find((r) => r[0] === 'res-b');
      expect(resRow[6]).toBe('checked_in');
      expect(resRow[7]).toBeTruthy();         // checked_in_at
    });

    test('late strike recorded when past grace period', () => {
      const store = buildStore();
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      // 8:15 AM — 15 min past session end, beyond 10-min grace
      withLocalTime(2026, 3, 10, 8, 15, () => {
        engine.checkInReservation(resId);
      });

      const strikes = store.sheets.strikes.rows;
      expect(strikes.length).toBe(1);
      expect(strikes[0][1]).toBe('persona@example.com');  // user_id
      expect(strikes[0][3]).toBe('late');                  // type
      expect(strikes[0][5]).toBe('session-a');             // source_id
    });

    test('no strike within grace period', () => {
      const store = buildStore();
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      // 8:02 AM — within 10-min grace
      withLocalTime(2026, 3, 10, 8, 2, () => {
        engine.checkInReservation(resId);
      });

      // Session should be force-ended
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('complete');

      // No strike recorded
      expect(store.sheets.strikes.rows.length).toBe(0);
    });

    test('no double-strike when late_strike_at already stamped', () => {
      const store = buildStore();
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      // Pre-stamp late_strike_at on the session (column index 15)
      const sessionRow = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      sessionRow[15] = localDate(2026, 3, 10, 8, 12);

      // Pre-seed a strike row
      store.sheets.strikes.rows.push([
        'strike-existing',
        'persona@example.com',
        'Driver',
        'late',
        'session',
        'session-a',
        'Overdue session',
        localDate(2026, 3, 10, 8, 12),
        '2026-03'
      ]);

      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      withLocalTime(2026, 3, 10, 8, 15, () => {
        engine.checkInReservation(resId);
      });

      // Still exactly 1 strike — no duplicate
      expect(store.sheets.strikes.rows.length).toBe(1);
    });

    test('does NOT force-end if session has not ended yet', () => {
      const store = buildStore();
      // Person A's session ends at 8:30, not yet overdue
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 30)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      // 8:05 AM — session still active until 8:30
      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow(/in use/i);
      });

      // Person A's session should still be active
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('active');
    });

    test('Person A\'s reservation is also completed after force-end', () => {
      const store = buildStore();
      // Person A: checked-in reservation 7:00–8:00
      pushReservation(store, {
        id: 'res-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0),
        status: 'checked_in',
        checkedInAt: localDate(2026, 3, 10, 7, 0)
      });
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      // Person B: reservation 8:00–9:00
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        engine.checkInReservation(resId);
      });

      // Person A's reservation should be complete
      const resA = store.sheets.reservations.rows.find((r) => r[0] === 'res-a');
      expect(resA[6]).toBe('complete');
    });

    test('admin can trigger force-end when checking in another user\'s reservation', () => {
      const store = buildStore();
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createAdminEngine(store);

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });

      // Person A's session should be force-ended
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('complete');

      // Person B should have new active session
      const sessionB = store.sheets.sessions.rows.find(
        (r) => r[2] === 'personb@example.com' && r[6] === 'active'
      );
      expect(sessionB).toBeTruthy();
    });

    test('no-op when charger has no active session — check-in succeeds normally', () => {
      const store = buildStore();
      // No active session on Charger 1
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });

      // Person B should have an active session
      const sessionB = store.sheets.sessions.rows.find(
        (r) => r[2] === 'personb@example.com' && r[6] === 'active'
      );
      expect(sessionB).toBeTruthy();
    });

    test('boundary: force-end at exact session end time (now == sessionEnd)', () => {
      const store = buildStore();
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      // Exactly 8:00 — session end time
      withLocalTime(2026, 3, 10, 8, 0, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });

      // Person A's session should be force-ended (now >= sessionEnd)
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('complete');
      expect(sessionA[16]).toBeTruthy(); // ended_at
    });

    test('different charger — no cross-charger force-end', () => {
      const store = buildStore();
      // Person A overdue on Charger 1
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      // Person B's reservation on Charger 2
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '2',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).not.toThrow();
      });

      // Person A's session on Charger 1 should NOT be affected
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('active');
      expect(sessionA[7]).toBe(true); // still active flag

      // Person B should have active session on Charger 2
      const sessionB = store.sheets.sessions.rows.find(
        (r) => r[2] === 'personb@example.com' && r[6] === 'active'
      );
      expect(sessionB).toBeTruthy();
      expect(String(sessionB[1])).toBe('2');
    });

    test('feature disabled via config — charger in use error, session not ended', () => {
      const store = buildStore();
      // Disable force-end feature
      store.sheets.config.rows.push(['force_end_on_checkin_enabled', 'false']);

      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      withLocalTime(2026, 3, 10, 8, 5, () => {
        expect(() => engine.checkInReservation(resId)).toThrow(/in use/i);
      });

      // Person A's session should NOT be ended
      const sessionA = store.sheets.sessions.rows.find((r) => r[0] === 'session-a');
      expect(sessionA[6]).toBe('active');
    });

    test('force-end at exact grace boundary records a strike', () => {
      const store = buildStore();
      // session_move_grace_minutes = 10 (already in config), session ends at 8:00
      pushSession(store, {
        id: 'session-a',
        chargerId: '1',
        userId: 'persona@example.com',
        start: localDate(2026, 3, 10, 7, 0),
        end: localDate(2026, 3, 10, 8, 0)
      });
      const resId = pushReservation(store, {
        id: 'res-b',
        chargerId: '1',
        userId: 'personb@example.com',
        start: localDate(2026, 3, 10, 8, 0),
        end: localDate(2026, 3, 10, 9, 0)
      });
      const engine = createUserEngine(store, 'personb@example.com');

      // Exactly 8:10 — at the grace boundary
      withLocalTime(2026, 3, 10, 8, 10, () => {
        engine.checkInReservation(resId);
      });

      // Strike should be recorded at exact boundary (>= grace)
      const strikes = store.sheets.strikes.rows;
      expect(strikes.length).toBe(1);
      expect(strikes[0][1]).toBe('persona@example.com');
      expect(strikes[0][3]).toBe('late');
    });
  });
});
