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
});
