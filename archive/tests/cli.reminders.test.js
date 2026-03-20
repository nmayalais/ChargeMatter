'use strict';

// Override Utilities.sleep to a no-op so retry back-off doesn't slow tests.
jest.mock('../cli/runtime', () => {
  const actual = jest.requireActual('../cli/runtime');
  return {
    createRuntime: (options) => {
      const rt = actual.createRuntime(options);
      rt.Utilities.sleep = jest.fn();
      rt.UrlFetchApp.fetch = jest.fn(() => ({
        getContentText() {
          return JSON.stringify({ ok: true });
        }
      }));
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
    const errorMessage = "We're sorry, a server error occurred. Please wait a bit and try again.";
    const store = buildStoreThrowingOnce(errorMessage);
    const engine = createTestEngine(store);

    expect(() => engine.sendReminders()).not.toThrow();
  });
});

describe('Notification cutoff', () => {
  function buildCutoffStore(configOverrides = []) {
    const store = buildBaseStore();
    // Add charger with active overdue session for sendReminders tests
    store.sheets.chargers.rows.push(['1', 'Charger 1', 60, '06:00,07:00,08:00', 'session-1']);
    const pastStart = new Date(Date.now() - 7200000); // 2 hours ago
    const pastEnd = new Date(Date.now() - 3600000); // 1 hour ago
    store.sheets.sessions.rows.push([
      'session-1', '1', 'driver@example.com', 'Driver',
      pastStart, pastEnd, 'active', true, true, false,
      false, false, false, '', '', '', ''
    ]);
    store.sheets.config.rows.push(['slack_webhook_url', 'https://hooks.example.com/test']);
    configOverrides.forEach(([key, value]) => {
      store.sheets.config.rows.push([key, value]);
    });
    return store;
  }

  test('overdue notification suppressed after cutoff hour', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 20, 0, 0)); // 8 PM
    try {
      const store = buildCutoffStore();
      const engine = createTestEngine(store);
      engine.sendReminders();
      // After cutoff: session marked overdue but no Slack notification sent
      const fetchCalls = engine.runtime.UrlFetchApp.fetch.mock.calls;
      expect(fetchCalls.length).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('notification still sends before cutoff hour', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 14, 0, 0)); // 2 PM
    try {
      const store = buildCutoffStore();
      // Set session times relative to the fake now
      const now = new Date();
      store.sheets.sessions.rows[0][4] = new Date(now.getTime() - 7200000); // start 2h ago
      store.sheets.sessions.rows[0][5] = new Date(now.getTime() - 3600000); // end 1h ago
      const engine = createTestEngine(store);
      engine.sendReminders();
      const fetchCalls = engine.runtime.UrlFetchApp.fetch.mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('notification_cutoff_hour: 0 disables cutoff', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 20, 0, 0)); // 8 PM
    try {
      const store = buildCutoffStore([['notification_cutoff_hour', '0']]);
      const now = new Date();
      store.sheets.sessions.rows[0][4] = new Date(now.getTime() - 7200000);
      store.sheets.sessions.rows[0][5] = new Date(now.getTime() - 3600000);
      const engine = createTestEngine(store);
      engine.sendReminders();
      const fetchCalls = engine.runtime.UrlFetchApp.fetch.mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('no-show notification suppressed after cutoff', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 20, 30, 0)); // 8:30 PM
    try {
      const store = buildCutoffStore();
      // Replace session with a no-show reservation scenario
      store.sheets.chargers.rows[0][4] = ''; // no active session
      store.sheets.sessions.rows = [];
      const now = new Date();
      const resStart = new Date(now.getTime() - 3600000); // started 1h ago
      const resEnd = new Date(now.getTime() + 7200000); // ends in 2h
      store.sheets.reservations.rows.push([
        'res-1', '1', 'driver@example.com', 'Driver',
        resStart, resEnd, 'confirmed', resStart, // checked_in_at
        '', '', '', '', now, now, '', ''
      ]);
      const engine = createTestEngine(store);
      engine.sendReminders();
      const fetchCalls = engine.runtime.UrlFetchApp.fetch.mock.calls;
      expect(fetchCalls.length).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
