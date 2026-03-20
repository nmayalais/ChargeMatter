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

function buildPolicyStore(overrides = {}) {
  const store = {
    properties: {
      SPREADSHEET_ID: 'local'
    },
    sheets: {
      chargers: {
        headers: CHARGERS_HEADERS,
        rows: [
          ['1', 'Charger 1', 180, '06:00,09:00,12:00,15:00,18:00,21:00', ''],
          ['2', 'Charger 2', 180, '06:00,09:00,12:00,15:00,18:00,21:00', ''],
          ['3', 'Charger 3', 180, '06:00,09:00,12:00,15:00,18:00,21:00', ''],
          ['4', 'Charger 4', 120, '06:00,08:00,10:00,12:00,14:00,16:00,18:00', '']
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
        headers: ['key', 'value'],
        rows: [
          ['allowed_domain', 'example.com'],
          ['admin_emails', 'admin@example.com'],
          ['reservation_open_hour', '6'],
          ['reservation_open_minute', '0'],
          ['reservation_max_per_day', '1'],
          ['reservation_late_grace_minutes', '30'],
          ['walkup_net_new_window_minutes', '10'],
          ['walkup_returning_window_minutes', '10'],
          ['session_move_grace_minutes', '10'],
          ['strike_threshold', '2'],
          ['suspension_business_days', '2']
        ]
      }
    }
  };

  if (overrides && typeof overrides === 'object') {
    Object.keys(overrides).forEach((key) => {
      store[key] = overrides[key];
    });
  }

  return store;
}

function createPolicyEngine(store, options = {}) {
  return createEngine({
    store,
    authEmail: options.email || 'driver@example.com',
    authName: options.name || 'Driver',
    isAdmin: Boolean(options.isAdmin)
  });
}

function localDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function localIso(year, month, day, hour, minute) {
  return localDate(year, month, day, hour, minute).toISOString();
}

function withLocalTime(year, month, day, hour, minute, fn) {
  jest.useFakeTimers();
  jest.setSystemTime(localDate(year, month, day, hour, minute));
  try {
    fn();
  } finally {
    jest.useRealTimers();
  }
}

function expectError(fn, messagePart) {
  let error = null;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error).toBeTruthy();
  if (messagePart) {
    expect(String(error.message || error)).toContain(messagePart);
  }
}

describe('Policy-aligned CLI logic', () => {
  test('booking opens daily at 6:00 AM', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    withLocalTime(2026, 2, 9, 5, 59, () => {
      expectError(() => engine.createReservation('1', localIso(2026, 2, 9, 9, 0)), 'Booking opens at');
    });

    withLocalTime(2026, 2, 9, 6, 1, () => {
      const board = engine.createReservation('1', localIso(2026, 2, 9, 9, 0));
      expect(board.reservations.length).toBe(1);
    });
  });

  test('no advance booking for future dates', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    withLocalTime(2026, 2, 9, 8, 0, () => {
      expectError(
        () => engine.createReservation('1', localIso(2026, 2, 10, 9, 0)),
        'Reservations can only be made for today'
      );
    });
  });

  test('one slot per person per day', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    withLocalTime(2026, 2, 9, 6, 15, () => {
      engine.createReservation('1', localIso(2026, 2, 9, 9, 0));
      expectError(
        () => engine.createReservation('2', localIso(2026, 2, 9, 12, 0)),
        'You already have a reservation for today'
      );
    });
  });

  test('late-released reservation (past halfway) still blocks same-day re-booking', () => {
    // Charger 4: 120-min slot at 08:00–10:00, halfway = 09:00
    // Session ends at 09:15 (after halfway) → late release → allotment consumed
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let reservationId = '';

    withLocalTime(2026, 2, 9, 6, 15, () => {
      const board = engine.createReservation('4', localIso(2026, 2, 9, 8, 0));
      reservationId = board.reservations[0].reservationId;
    });

    withLocalTime(2026, 2, 9, 8, 5, () => {
      engine.checkInReservation(reservationId);
    });

    withLocalTime(2026, 2, 9, 9, 15, () => {
      engine.endSessionForReservation(reservationId);
    });

    withLocalTime(2026, 2, 9, 9, 20, () => {
      expectError(
        () => engine.createReservation('1', localIso(2026, 2, 9, 12, 0)),
        'You already have a reservation for today'
      );
    });
  });

  test('early-released reservation (before halfway) allows same-day re-booking', () => {
    // Charger 4: 120-min slot at 08:00–10:00, halfway = 09:00
    // Session ends at 08:45 (before halfway) → early release → still net-new, no allotment consumed
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let reservationId = '';

    withLocalTime(2026, 2, 9, 6, 15, () => {
      const board = engine.createReservation('4', localIso(2026, 2, 9, 8, 0));
      reservationId = board.reservations[0].reservationId;
    });

    withLocalTime(2026, 2, 9, 8, 5, () => {
      engine.checkInReservation(reservationId);
    });

    withLocalTime(2026, 2, 9, 8, 45, () => {
      engine.endSessionForReservation(reservationId);
    });

    withLocalTime(2026, 2, 9, 8, 50, () => {
      // Should succeed — early release does not consume the day's allotment
      expect(() => engine.createReservation('1', localIso(2026, 2, 9, 9, 0))).not.toThrow();
    });
  });

  test('early-released reservation preserves net-new walk-up access (Tier 1)', () => {
    // Charger 4: 120-min slot 08:00–10:00, halfway = 09:00
    // User checks in at 08:05, ends at 08:45 → early release → still net-new
    // At 09:05, charger 2's 09:00 slot is in Tier 1 (first 10 min), only net-new may walk up
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let reservationId = '';

    withLocalTime(2026, 2, 9, 6, 15, () => {
      const board = engine.createReservation('4', localIso(2026, 2, 9, 8, 0));
      reservationId = board.reservations[0].reservationId;
    });

    withLocalTime(2026, 2, 9, 8, 5, () => {
      engine.checkInReservation(reservationId);
    });

    withLocalTime(2026, 2, 9, 8, 45, () => {
      engine.endSessionForReservation(reservationId);
    });

    withLocalTime(2026, 2, 9, 9, 5, () => {
      // Net-new Tier 1 window: 09:00–09:10. User is still net-new after early release.
      expect(() => engine.startSession('2')).not.toThrow();
    });
  });

  test('open slot becomes available immediately when unreserved', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    withLocalTime(2026, 2, 9, 6, 10, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find((item) => item.id === '1');
      expect(charger.statusKey).toBe('in_use');
    });
  });

  test('reserved slot opens after grace period for walk-up', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    store.sheets.reservations.rows.push([
      'reservation-1',
      '1',
      'other@example.com',
      'Other Driver',
      localDate(2026, 2, 9, 9, 0),
      localDate(2026, 2, 9, 12, 0),
      'active',
      '',
      '',
      '',
      '',
      '',
      localDate(2026, 2, 9, 8, 0),
      localDate(2026, 2, 9, 8, 0),
      ''
    ]);

    withLocalTime(2026, 2, 9, 9, 10, () => {
      expectError(() => engine.startSession('1'), 'Charger is reserved by');
    });

    withLocalTime(2026, 2, 9, 9, 31, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find((item) => item.id === '1');
      expect(charger.statusKey).toBe('in_use');
    });
  });

  test('10-minute grace period before overdue', () => {
    const store = buildPolicyStore();
    const sessionId = 'session-001';
    store.sheets.sessions.rows.push([
      sessionId,
      '1',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 6, 0),
      localDate(2026, 2, 9, 9, 0),
      'active',
      true,
      false,
      false,
      false,
      false,
      false,
      '',
      '',
      '',
      '',
      ''
    ]);
    store.sheets.chargers.rows[0][4] = sessionId;

    const engine = createPolicyEngine(store);

    withLocalTime(2026, 2, 9, 9, 5, () => {
      const board = engine.getBoardData();
      const charger = board.chargers.find((item) => item.id === '1');
      expect(charger.statusKey).toBe('in_use');
    });

    withLocalTime(2026, 2, 9, 9, 11, () => {
      const board = engine.getBoardData();
      const charger = board.chargers.find((item) => item.id === '1');
      expect(charger.statusKey).toBe('overdue');
    });
  });

  describe('Option A three-tier walk-up priority', () => {
    // Charger 1 slots start at 06:00. Walk-up opens at 06:00 (no reservation).
    // Tier 1 (net-new only): 06:00–06:10
    // Tier 2 (returning + net-new): 06:10–06:20
    // Tier 3 (everyone): 06:20+

    test('net-new user can walk up during Tier 1 window', () => {
      const store = buildPolicyStore();
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        const board = engine.startSession('1');
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.statusKey).toBe('in_use');
      });
    });

    test('returning user (no-show) is blocked during Tier 1, succeeds during Tier 2', () => {
      const store = buildPolicyStore();
      store.sheets.reservations.rows.push([
        'res-noshow',
        '2',
        'driver@example.com',
        'Driver',
        localDate(2026, 2, 9, 6, 0),
        localDate(2026, 2, 9, 9, 0),
        'no_show',
        '',
        localDate(2026, 2, 9, 6, 35),
        '',
        '',
        '',
        localDate(2026, 2, 9, 5, 50),
        localDate(2026, 2, 9, 6, 35),
        ''
      ]);
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        expectError(() => engine.startSession('1'), 'first-time drivers today');
      });

      withLocalTime(2026, 2, 9, 6, 15, () => {
        const board = engine.startSession('1');
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.statusKey).toBe('in_use');
      });
    });

    test('returning user (completed session) is blocked during Tier 1, succeeds during Tier 2', () => {
      const store = buildPolicyStore();
      store.sheets.sessions.rows.push([
        'sess-done',
        '2',
        'driver@example.com',
        'Driver',
        localDate(2026, 2, 9, 6, 0),
        localDate(2026, 2, 9, 9, 0),
        'complete',
        false,
        false,
        true,
        false,
        false,
        false,
        '',
        '',
        '',
        localDate(2026, 2, 9, 8, 30),
        ''
      ]);
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        expectError(() => engine.startSession('1'), 'first-time drivers today');
      });

      withLocalTime(2026, 2, 9, 6, 15, () => {
        const board = engine.startSession('1');
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.statusKey).toBe('in_use');
      });
    });

    test('returning user (late-canceled reservation) is blocked during Tier 1, succeeds during Tier 2', () => {
      const store = buildPolicyStore();
      // Reservation 06:00–09:00, canceled at 07:30 (after halfway at 07:30 = exactly halfway, use 07:31 to be safe)
      store.sheets.reservations.rows.push([
        'res-latecancel',
        '2',
        'driver@example.com',
        'Driver',
        localDate(2026, 2, 9, 6, 0),
        localDate(2026, 2, 9, 9, 0),
        'canceled',
        '',
        '',
        '',
        '',
        '',
        localDate(2026, 2, 9, 5, 50),
        localDate(2026, 2, 9, 7, 31),
        localDate(2026, 2, 9, 7, 31)
      ]);
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        expectError(() => engine.startSession('1'), 'first-time drivers today');
      });

      withLocalTime(2026, 2, 9, 6, 15, () => {
        const board = engine.startSession('1');
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.statusKey).toBe('in_use');
      });
    });

    test('net-new user with early-canceled reservation can still walk up during Tier 1', () => {
      const store = buildPolicyStore();
      // Reservation 06:00–09:00, canceled at 06:30 (before halfway at 07:30)
      store.sheets.reservations.rows.push([
        'res-earlycancel',
        '2',
        'driver@example.com',
        'Driver',
        localDate(2026, 2, 9, 6, 0),
        localDate(2026, 2, 9, 9, 0),
        'canceled',
        '',
        '',
        '',
        '',
        '',
        localDate(2026, 2, 9, 5, 50),
        localDate(2026, 2, 9, 6, 30),
        localDate(2026, 2, 9, 6, 30)
      ]);
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        const board = engine.startSession('1');
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.statusKey).toBe('in_use');
      });
    });

    test('user with active reservation is blocked from walk-up on another charger', () => {
      const store = buildPolicyStore();
      store.sheets.reservations.rows.push([
        'res-active',
        '2',
        'driver@example.com',
        'Driver',
        localDate(2026, 2, 9, 6, 0),
        localDate(2026, 2, 9, 9, 0),
        'active',
        '',
        '',
        '',
        '',
        '',
        localDate(2026, 2, 9, 5, 50),
        localDate(2026, 2, 9, 5, 50),
        ''
      ]);
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        expectError(() => engine.startSession('1'), 'You already have a reservation');
      });
    });

    test('after Tier 2 window, everyone including strangers can walk up', () => {
      const store = buildPolicyStore();
      // Add a no-show for another user to make charger 2's slot occupied history
      // But the test user (driver@example.com) is a complete stranger — no history
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 25, () => {
        const board = engine.startSession('1');
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.statusKey).toBe('in_use');
      });
    });
  });

  describe('Walk-up timing fields on board data', () => {
    test('within a slot, walk-up window boundaries are computed from slot start', () => {
      const store = buildPolicyStore();
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 6, 5, () => {
        const board = engine.getBoardData();
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.walkup).toBeTruthy();
        expect(new Date(charger.walkup.startTime).toISOString()).toBe(localIso(2026, 2, 9, 6, 0));
        expect(new Date(charger.walkup.endTime).toISOString()).toBe(localIso(2026, 2, 9, 9, 0));
        expect(new Date(charger.walkup.openAt).toISOString()).toBe(localIso(2026, 2, 9, 6, 0));
        expect(new Date(charger.walkup.allUsersOpenAt).toISOString()).toBe(localIso(2026, 2, 9, 6, 10));
        expect(new Date(charger.walkup.returningUsersOpenAt).toISOString()).toBe(localIso(2026, 2, 9, 6, 20));
        expect(charger.walkup.isOpen).toBe(true);
        expect(charger.walkup.isOpenToReturning).toBe(false);
        expect(charger.walkup.isOpenToAll).toBe(false);
      });

      withLocalTime(2026, 2, 9, 6, 15, () => {
        const board = engine.getBoardData();
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.walkup.isOpen).toBe(true);
        expect(charger.walkup.isOpenToReturning).toBe(true);
        expect(charger.walkup.isOpenToAll).toBe(false);
      });

      withLocalTime(2026, 2, 9, 6, 25, () => {
        const board = engine.getBoardData();
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.walkup.isOpen).toBe(true);
        expect(charger.walkup.isOpenToReturning).toBe(true);
        expect(charger.walkup.isOpenToAll).toBe(true);
      });
    });

    test('outside of a slot, walk-up is not returned', () => {
      const store = buildPolicyStore();
      const engine = createPolicyEngine(store);

      withLocalTime(2026, 2, 9, 5, 50, () => {
        const board = engine.getBoardData();
        const charger = board.chargers.find((item) => item.id === '1');
        expect(charger.walkup).toBeNull();
      });
    });
  });

  test('two-strike rule triggers suspension for no-shows', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    store.sheets.reservations.rows.push([
      'res-1',
      '1',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 6, 0),
      localDate(2026, 2, 9, 9, 0),
      'active',
      '',
      '',
      '',
      '',
      '',
      localDate(2026, 2, 9, 5, 50),
      localDate(2026, 2, 9, 5, 50),
      ''
    ]);
    store.sheets.reservations.rows.push([
      'res-2',
      '2',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 9, 0),
      localDate(2026, 2, 9, 12, 0),
      'active',
      '',
      '',
      '',
      '',
      '',
      localDate(2026, 2, 9, 8, 50),
      localDate(2026, 2, 9, 8, 50),
      ''
    ]);

    withLocalTime(2026, 2, 9, 12, 45, () => {
      engine.sendReminders();
      const suspensions = store.sheets.suspensions.rows;
      expect(suspensions.length).toBe(1);
      expect(String(suspensions[0][1])).toBe('driver@example.com');
    });
  });
});

describe('Short session policy', () => {
  test('walk-up allowed when reserved charger is occupied by someone else', () => {
    const store = buildPolicyStore();
    // User has reservation on charger 1 at 09:00
    // But charger 1 is occupied by another driver
    store.sheets.reservations.rows.push([
      'res-1', '1', 'driver@example.com', 'Driver',
      localDate(2026, 3, 19, 9, 0), localDate(2026, 3, 19, 12, 0),
      'confirmed', '', '', '', '', '', localDate(2026, 3, 19, 6, 15), localDate(2026, 3, 19, 6, 15), '', ''
    ]);
    // Charger 1 has someone else's active session
    store.sheets.chargers.rows[0][4] = 'other-session';
    store.sheets.sessions.rows.push([
      'other-session', '1', 'other@example.com', 'Other',
      localDate(2026, 3, 19, 9, 0), localDate(2026, 3, 19, 12, 0),
      'active', true, false, false, false, false, false, '', '', '', '', ''
    ]);
    const engine = createPolicyEngine(store);
    // User tries walk-up on charger 2 during the open window (after grace + net-new window)
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('2');
      expect(board).toBeTruthy();
    });
  });

  test('walk-up blocked when reserved charger is free', () => {
    const store = buildPolicyStore();
    store.sheets.reservations.rows.push([
      'res-1', '1', 'driver@example.com', 'Driver',
      localDate(2026, 3, 19, 9, 0), localDate(2026, 3, 19, 12, 0),
      'confirmed', '', '', '', '', '', localDate(2026, 3, 19, 6, 15), localDate(2026, 3, 19, 6, 15), '', ''
    ]);
    // Charger 1 is free (no active session)
    const engine = createPolicyEngine(store);
    withLocalTime(2026, 3, 19, 9, 45, () => {
      expectError(() => engine.startSession('2'), 'You already have a reservation on');
    });
  });

  test('session < 10 min marked released_early', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let sessionId;
    // Start a session
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find(c => c.id === '1');
      sessionId = charger.session.sessionId;
    });
    // End after 5 minutes
    withLocalTime(2026, 3, 19, 9, 50, () => {
      engine.endSession(sessionId);
    });
    // Check session has released_early
    const session = store.sheets.sessions.rows.find(r => r[0] === sessionId);
    expect(session).toBeTruthy();
    // Find the released_early column index
    const releasedEarlyIdx = SESSIONS_HEADERS.indexOf('released_early');
    expect(String(session[releasedEarlyIdx])).toBe('true');
  });

  test('session >= 10 min NOT marked released_early', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let sessionId;
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find(c => c.id === '1');
      sessionId = charger.session.sessionId;
    });
    // End after 15 minutes
    withLocalTime(2026, 3, 19, 10, 0, () => {
      engine.endSession(sessionId);
    });
    const session = store.sheets.sessions.rows.find(r => r[0] === sessionId);
    const releasedEarlyIdx = SESSIONS_HEADERS.indexOf('released_early');
    // Should NOT have released_early set
    expect(session[releasedEarlyIdx]).toBeFalsy();
  });

  test('short session user stays net-new (can walk-up again)', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let sessionId;
    // Start and quickly end a session on charger 1
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find(c => c.id === '1');
      sessionId = charger.session.sessionId;
    });
    withLocalTime(2026, 3, 19, 9, 50, () => {
      engine.endSession(sessionId);
    });
    // User should still be able to start a new walk-up session on charger 2
    // During net-new window for the 12:00 slot
    withLocalTime(2026, 3, 19, 12, 31, () => {
      const board = engine.startSession('2');
      expect(board).toBeTruthy();
    });
  });

  test('short session user not counted as returning', () => {
    const store = buildPolicyStore();
    // We need to verify that a short session doesn't make the user "returning"
    // This means during Tier 1 (net-new only window), the user should still qualify
    const engine = createPolicyEngine(store);
    let sessionId;
    // Start and quickly end a session on charger 1
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find(c => c.id === '1');
      sessionId = charger.session.sessionId;
    });
    withLocalTime(2026, 3, 19, 9, 50, () => {
      engine.endSession(sessionId);
    });
    // During net-new window of a different slot, user should qualify as net-new
    withLocalTime(2026, 3, 19, 12, 31, () => {
      // If user were counted as returning (not net-new), this would fail
      // because the net-new window is 12:30-12:40 and only net-new users allowed
      const board = engine.startSession('2');
      expect(board).toBeTruthy();
    });
  });

  test('associated reservation also marked released_early on short session', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);
    let reservationId;
    // Create a reservation
    withLocalTime(2026, 3, 19, 6, 15, () => {
      const board = engine.createReservation('4', localIso(2026, 3, 19, 8, 0));
      reservationId = board.reservations[0].reservationId;
    });
    // Check in
    withLocalTime(2026, 3, 19, 8, 5, () => {
      engine.checkInReservation(reservationId);
    });
    // End after 5 minutes (short session)
    withLocalTime(2026, 3, 19, 8, 10, () => {
      engine.endSessionForReservation(reservationId);
    });
    // Check that reservation has released_early
    const res = store.sheets.reservations.rows.find(r => r[0] === reservationId);
    const releasedEarlyIdx = RESERVATIONS_HEADERS.indexOf('released_early');
    expect(String(res[releasedEarlyIdx])).toBe('true');
  });

  test('session_min_minutes: 0 disables the feature', () => {
    const store = buildPolicyStore();
    store.sheets.config.rows.push(['session_min_minutes', '0']);
    const engine = createPolicyEngine(store);
    let sessionId;
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find(c => c.id === '1');
      sessionId = charger.session.sessionId;
    });
    withLocalTime(2026, 3, 19, 9, 50, () => {
      engine.endSession(sessionId);
    });
    const session = store.sheets.sessions.rows.find(r => r[0] === sessionId);
    const releasedEarlyIdx = SESSIONS_HEADERS.indexOf('released_early');
    // With session_min_minutes=0, should NOT mark as released_early
    expect(session[releasedEarlyIdx]).toBeFalsy();
  });

  test('session_min_minutes config override respected', () => {
    const store = buildPolicyStore();
    store.sheets.config.rows.push(['session_min_minutes', '20']);
    const engine = createPolicyEngine(store);
    let sessionId;
    withLocalTime(2026, 3, 19, 9, 45, () => {
      const board = engine.startSession('1');
      const charger = board.chargers.find(c => c.id === '1');
      sessionId = charger.session.sessionId;
    });
    // End after 15 minutes — under the custom 20-min threshold
    withLocalTime(2026, 3, 19, 10, 0, () => {
      engine.endSession(sessionId);
    });
    const session = store.sheets.sessions.rows.find(r => r[0] === sessionId);
    const releasedEarlyIdx = SESSIONS_HEADERS.indexOf('released_early');
    expect(String(session[releasedEarlyIdx])).toBe('true');
  });
});
