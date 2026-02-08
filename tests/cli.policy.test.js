'use strict';

const { createEngine } = require('../cli/engine');

function buildPolicyStore(overrides = {}) {
  const store = {
    properties: {
      SPREADSHEET_ID: 'local'
    },
    sheets: {
      chargers: {
        headers: ['charger_id', 'name', 'max_minutes', 'slot_starts', 'active_session_id'],
        rows: [
          ['1', 'Charger 1', 180, '06:00,09:00,12:00,15:00,18:00,21:00', ''],
          ['2', 'Charger 2', 180, '06:00,09:00,12:00,15:00,18:00,21:00', ''],
          ['3', 'Charger 3', 180, '06:00,09:00,12:00,15:00,18:00,21:00', ''],
          ['4', 'Charger 4', 120, '06:00,08:00,10:00,12:00,14:00,16:00,18:00', '']
        ]
      },
      sessions: {
        headers: [
          'session_id',
          'charger_id',
          'user_id',
          'user_name',
          'start_time',
          'end_time',
          'status',
          'active',
          'overdue',
          'complete',
          'reminder_10_sent',
          'reminder_5_sent',
          'reminder_0_sent',
          'overdue_last_sent_at',
          'grace_notified_at',
          'late_strike_at',
          'ended_at'
        ],
        rows: []
      },
      reservations: {
        headers: [
          'reservation_id',
          'charger_id',
          'user_id',
          'user_name',
          'start_time',
          'end_time',
          'status',
          'checked_in_at',
          'no_show_at',
          'no_show_strike_at',
          'reminder_5_before_sent',
          'reminder_5_after_sent',
          'created_at',
          'updated_at',
          'canceled_at'
        ],
        rows: []
      },
      strikes: {
        headers: [
          'strike_id',
          'user_id',
          'user_name',
          'type',
          'source_type',
          'source_id',
          'reason',
          'occurred_at',
          'month_key'
        ],
        rows: []
      },
      suspensions: {
        headers: ['suspension_id', 'user_id', 'user_name', 'start_at', 'end_at', 'reason', 'active', 'created_at'],
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
      expectError(
        () => engine.createReservation('1', localIso(2026, 2, 9, 9, 0)),
        'Booking opens at'
      );
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

  test('open slot becomes available after 30 minutes', () => {
    const store = buildPolicyStore();
    const engine = createPolicyEngine(store);

    withLocalTime(2026, 2, 9, 6, 10, () => {
      expectError(
        () => engine.startSession('1'),
        'opens at'
      );
    });

    withLocalTime(2026, 2, 9, 6, 31, () => {
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
