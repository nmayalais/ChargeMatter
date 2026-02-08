'use strict';

function seedStore(store, options = {}) {
  store.properties = store.properties || {};
  store.properties.SPREADSHEET_ID = store.properties.SPREADSHEET_ID || 'local';
  store.sheets = store.sheets || {};

  store.sheets.chargers = {
    headers: ['charger_id', 'name', 'max_minutes', 'slot_starts', 'active_session_id'],
    rows: [
      ['1', 'Charger 1', 60, '06:00,08:00,10:00,12:00,14:00,16:00', ''],
      ['2', 'Charger 2', 90, '07:00,09:00,11:00,13:00,15:00', '']
    ]
  };

  store.sheets.sessions = {
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
  };

  store.sheets.reservations = {
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
  };

  store.sheets.strikes = {
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
  };

  store.sheets.suspensions = {
    headers: ['suspension_id', 'user_id', 'user_name', 'start_at', 'end_at', 'reason', 'active', 'created_at'],
    rows: []
  };

  store.sheets.config = {
    headers: ['key', 'value'],
    rows: [
      ['allowed_domain', 'example.com'],
      ['admin_emails', (options.userEmail || 'admin@example.com')],
      ['reservation_open_hour', '6'],
      ['reservation_open_minute', '0']
    ]
  };
}

module.exports = {
  seedStore
};
