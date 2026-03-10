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

const {
  createEngine,
  CHARGERS_HEADERS,
  SESSIONS_HEADERS,
  RESERVATIONS_HEADERS,
  STRIKES_HEADERS,
  SUSPENSIONS_HEADERS,
  CONFIG_HEADERS
} = require('../cli/engine');

function buildBaseStore() {
  return {
    properties: { SPREADSHEET_ID: 'local' },
    sheets: {
      chargers: {
        headers: CHARGERS_HEADERS,
        rows: []
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
