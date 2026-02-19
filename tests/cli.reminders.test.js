'use strict';

// Override Utilities.sleep to a no-op so retry back-off doesn't slow tests.
jest.mock('../cli/runtime', () => {
  const actual = jest.requireActual('../cli/runtime');
  return {
    createRuntime: (options) => {
      const rt = actual.createRuntime(options);
      rt.Utilities.sleep = jest.fn();
      return rt;
    }
  };
});

const { createEngine } = require('../cli/engine');

function buildBaseStore() {
  return {
    properties: { SPREADSHEET_ID: 'local' },
    sheets: {
      chargers: {
        headers: ['charger_id', 'name', 'max_minutes', 'slot_starts', 'active_session_id'],
        rows: []
      },
      sessions: {
        headers: [
          'session_id', 'charger_id', 'user_id', 'user_name', 'start_time', 'end_time',
          'status', 'active', 'overdue', 'complete', 'reminder_10_sent', 'reminder_5_sent',
          'reminder_0_sent', 'overdue_last_sent_at', 'grace_notified_at', 'late_strike_at', 'ended_at'
        ],
        rows: []
      },
      reservations: {
        headers: [
          'reservation_id', 'charger_id', 'user_id', 'user_name', 'start_time', 'end_time',
          'status', 'checked_in_at', 'no_show_at', 'no_show_strike_at',
          'reminder_5_before_sent', 'reminder_5_after_sent', 'created_at', 'updated_at', 'canceled_at'
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

// Returns a store that throws errorMessage on the first access to `sheets`,
// then returns normal sheet data on all subsequent accesses.
function buildStoreThrowingOnce(errorMessage) {
  const base = buildBaseStore();
  let thrown = false;
  return {
    properties: base.properties,
    get sheets() {
      if (!thrown) {
        thrown = true;
        throw new Error(errorMessage);
      }
      return base.sheets;
    }
  };
}

function createTestEngine(store) {
  return createEngine({
    store,
    authEmail: 'admin@example.com',
    authName: 'Admin',
    isAdmin: true
  });
}

describe('sendReminders transient error handling', () => {
  test('"Service Spreadsheets failed" error is retried and does not propagate', () => {
    // This is the exact error pattern seen in the production failure email
    // (2/18/26 9:01 PM): "Service Spreadsheets failed while accessing document..."
    // isTransientError_() does not recognize this pattern, so runWithRetries_()
    // never retries it — the error is re-thrown immediately and Apps Script
    // reports a failure.
    const errorMessage =
      'Service Spreadsheets failed while accessing document with id 1K1319vu2-OlQCMgfD4XOpYiHpX7YdyoL9GSteSe_Mfs.';
    const store = buildStoreThrowingOnce(errorMessage);
    const engine = createTestEngine(store);

    // sendReminders should retry on this transient Google infrastructure error
    // and succeed on the second attempt instead of propagating the error.
    expect(() => engine.sendReminders()).not.toThrow();
  });

  test('"server error occurred" error is already retried correctly', () => {
    // This matches the 2/18/26 6:36 AM failure — already recognised as transient,
    // so it was retried. It still failed because the outage lasted all 3 attempts.
    // This test confirms that pattern continues to work after any future changes.
    const errorMessage =
      "We're sorry, a server error occurred. Please wait a bit and try again.";
    const store = buildStoreThrowingOnce(errorMessage);
    const engine = createTestEngine(store);

    expect(() => engine.sendReminders()).not.toThrow();
  });
});
