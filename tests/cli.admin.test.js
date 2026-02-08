'use strict';

const { createEngine } = require('../cli/engine');

function buildStore() {
  return {
    properties: {
      SPREADSHEET_ID: 'local'
    },
    sheets: {
      chargers: {
        headers: ['charger_id', 'name', 'max_minutes', 'slot_starts', 'active_session_id'],
        rows: [
          ['1', 'Charger 1', 60, '06:00,07:00,08:00', 'session-1']
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
        rows: [
          ['session-1', '1', 'driver@example.com', 'Driver', new Date(), new Date(Date.now() + 3600000), 'active', true, false, false, false, false, false, '', '', '', '']
        ]
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
        headers: ['strike_id', 'user_id', 'user_name', 'type', 'source_type', 'source_id', 'reason', 'occurred_at', 'month_key'],
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
          ['admin_emails', 'admin@example.com']
        ]
      }
    }
  };
}

function createEngineFor(email) {
  return createEngine({
    store: buildStore(),
    authEmail: email,
    authName: 'User',
    isAdmin: false
  });
}

describe('Admin permissions (backend)', () => {
  test('non-admin cannot force end', () => {
    const engine = createEngineFor('user@example.com');
    expect(() => engine.forceEnd('1')).toThrow('Admin access required');
  });

  test('non-admin cannot reset charger', () => {
    const engine = createEngineFor('user@example.com');
    expect(() => engine.resetCharger('1')).toThrow('Admin access required');
  });

  test('admin can force end and reset', () => {
    const store = buildStore();
    const engine = createEngine({
      store,
      authEmail: 'admin@example.com',
      authName: 'Admin',
      isAdmin: true
    });

    expect(() => engine.forceEnd('1')).not.toThrow();
    expect(() => engine.resetCharger('1')).not.toThrow();
  });
});
