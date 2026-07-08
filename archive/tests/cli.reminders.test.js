'use strict';

// Override Utilities.sleep to a no-op so retry back-off doesn't slow tests.
jest.mock('../cli/runtime', () => {
  const actual = jest.requireActual('../cli/runtime');
  return {
    createRuntime: (options) => {
      const rt = actual.createRuntime(options);
      rt.Utilities.sleep = jest.fn();
      rt.UrlFetchApp.fetch = jest.fn((url, options = {}) => ({
        getContentText() {
          if (String(url).includes('users.lookupByEmail')) {
            return JSON.stringify({ ok: true, user: { id: 'U123' } });
          }
          if (String(url).includes('conversations.open')) {
            return JSON.stringify({ ok: true, channel: { id: 'D123' } });
          }
          if (String(url).includes('chat.postMessage')) {
            return JSON.stringify({ ok: true, url, options });
          }
          return JSON.stringify({ ok: true, url, options });
        }
      }));
      rt.MailApp.sendEmail = jest.fn(() => true);
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

function addSlackBotConfig(store) {
  store.sheets.config.rows.push(['slack_bot_token', 'xoxb-test']);
  store.sheets.config.rows.push(['slack_webhook_channel', 'C123']);
  store.sheets.config.rows.push(['slack_webhook_url', 'https://hooks.example.com/test']);
  store.sheets.config.rows.push(['reminder_10_enabled', 'TRUE']);
  store.sheets.config.rows.push(['reminder_5_enabled', 'TRUE']);
}

function chatPostChannels(engine) {
  return engine.runtime.UrlFetchApp.fetch.mock.calls
    .filter(([url]) => String(url).includes('chat.postMessage'))
    .map(([, options]) => JSON.parse(options.payload).channel);
}

function pushSession(store, overrides = {}) {
  const now = new Date();
  store.sheets.chargers.rows.push([
    overrides.chargerId || '1',
    overrides.chargerName || 'Charger 1',
    60,
    '06:00,07:00,08:00,09:00',
    overrides.sessionId || 'session-1'
  ]);
  store.sheets.sessions.rows.push([
    overrides.sessionId || 'session-1',
    overrides.chargerId || '1',
    overrides.userEmail || 'driver@example.com',
    overrides.userName || 'Driver',
    overrides.start || new Date(now.getTime() - 3000000),
    overrides.end || new Date(now.getTime() + 600000),
    overrides.status || 'active',
    overrides.active !== undefined ? overrides.active : true,
    overrides.overdue !== undefined ? overrides.overdue : false,
    false,
    overrides.reminder10 || false,
    overrides.reminder5 || false,
    overrides.reminder0 || false,
    overrides.overdueLastSentAt || '',
    overrides.graceNotifiedAt || '',
    overrides.lateStrikeAt || '',
    '',
    ''
  ]);
}

function pushReservation(store, overrides = {}) {
  const now = new Date();
  store.sheets.reservations.rows.push([
    overrides.reservationId || 'res-1',
    overrides.chargerId || '1',
    overrides.userEmail || 'driver@example.com',
    overrides.userName || 'Driver',
    overrides.start || new Date(now.getTime() + 300000),
    overrides.end || new Date(now.getTime() + 3900000),
    overrides.status || 'active',
    overrides.checkedInAt || '',
    '',
    '',
    overrides.reminderBefore || '',
    overrides.reminderAfter || '',
    now,
    now,
    '',
    ''
  ]);
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

describe('DM-first notification routing', () => {
  test('routine session reminder sends a Slack DM, not a public channel post', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 8, 50, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      pushSession(store, {
        start: new Date(2026, 2, 19, 8, 0, 0),
        end: new Date(2026, 2, 19, 9, 0, 0)
      });
      const engine = createTestEngine(store);

      engine.sendReminders();

      expect(chatPostChannels(engine)).toContain('D123');
      expect(chatPostChannels(engine)).not.toContain('C123');
      expect(store.sheets.sessions.rows[0][10]).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('reservation upcoming reminder sends a Slack DM, not a public channel post', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 8, 55, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      store.sheets.chargers.rows.push(['1', 'Charger 1', 60, '09:00,10:00', '']);
      pushReservation(store, {
        start: new Date(2026, 2, 19, 9, 0, 0),
        end: new Date(2026, 2, 19, 10, 0, 0)
      });
      const engine = createTestEngine(store);

      engine.sendReminders();

      expect(chatPostChannels(engine)).toContain('D123');
      expect(chatPostChannels(engine)).not.toContain('C123');
      expect(store.sheets.reservations.rows[0][10]).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('reservation late reminder inside grace sends a Slack DM, not a public channel post', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 9, 5, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      store.sheets.chargers.rows.push(['1', 'Charger 1', 60, '09:00,10:00', '']);
      pushReservation(store, {
        start: new Date(2026, 2, 19, 9, 0, 0),
        end: new Date(2026, 2, 19, 10, 0, 0)
      });
      const engine = createTestEngine(store);

      engine.sendReminders();

      expect(chatPostChannels(engine)).toContain('D123');
      expect(chatPostChannels(engine)).not.toContain('C123');
      expect(store.sheets.reservations.rows[0][11]).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('grace escalation still posts to the public channel', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 9, 15, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      const now = new Date();
      pushSession(store, {
        start: new Date(2026, 2, 19, 8, 0, 0),
        end: new Date(2026, 2, 19, 9, 0, 0),
        reminder0: true,
        overdueLastSentAt: now
      });
      const engine = createTestEngine(store);

      engine.sendReminders();

      expect(chatPostChannels(engine)).toContain('C123');
      expect(store.sheets.sessions.rows[0][14]).toEqual(now);
    } finally {
      jest.useRealTimers();
    }
  });

  test('no-show release still posts to the public channel', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 9, 40, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      store.sheets.chargers.rows.push(['1', 'Charger 1', 60, '09:00,10:00', '']);
      pushReservation(store, {
        start: new Date(2026, 2, 19, 9, 0, 0),
        end: new Date(2026, 2, 19, 10, 0, 0)
      });
      const engine = createTestEngine(store);

      engine.sendReminders();

      expect(chatPostChannels(engine)).toContain('C123');
      expect(store.sheets.reservations.rows[0][6]).toBe('no_show');
    } finally {
      jest.useRealTimers();
    }
  });

  test('channel escalation config suppresses public escalation without sending it as a DM', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 9, 15, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      store.sheets.config.rows.push(['channel_escalations_enabled', 'FALSE']);
      pushSession(store, {
        start: new Date(2026, 2, 19, 8, 0, 0),
        end: new Date(2026, 2, 19, 9, 0, 0),
        reminder0: true,
        overdueLastSentAt: new Date()
      });
      const engine = createTestEngine(store);

      engine.sendReminders();

      expect(chatPostChannels(engine)).not.toContain('C123');
      expect(chatPostChannels(engine)).not.toContain('D123');
      expect(store.sheets.sessions.rows[0][14]).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Slack DM failure falls back to email and marks the reminder sent', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 8, 50, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      pushSession(store, {
        start: new Date(2026, 2, 19, 8, 0, 0),
        end: new Date(2026, 2, 19, 9, 0, 0)
      });
      const engine = createTestEngine(store);
      engine.runtime.UrlFetchApp.fetch.mockImplementation((url) => ({
        getContentText() {
          if (String(url).includes('users.lookupByEmail')) {
            return JSON.stringify({ ok: false });
          }
          return JSON.stringify({ ok: true });
        }
      }));

      engine.sendReminders();

      expect(engine.runtime.MailApp.sendEmail).toHaveBeenCalledWith(
        'driver@example.com',
        'EV Charging reminder',
        expect.stringContaining('ends in 10 minutes')
      );
      expect(chatPostChannels(engine)).not.toContain('C123');
      expect(store.sheets.sessions.rows[0][10]).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('failed DM and failed email leaves reminder flag unset for retry', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 19, 8, 50, 0));
    try {
      const store = buildBaseStore();
      addSlackBotConfig(store);
      pushSession(store, {
        start: new Date(2026, 2, 19, 8, 0, 0),
        end: new Date(2026, 2, 19, 9, 0, 0)
      });
      const engine = createTestEngine(store);
      engine.runtime.UrlFetchApp.fetch.mockImplementation((url) => ({
        getContentText() {
          if (String(url).includes('users.lookupByEmail')) {
            return JSON.stringify({ ok: false });
          }
          return JSON.stringify({ ok: true });
        }
      }));
      engine.runtime.MailApp.sendEmail.mockImplementation(() => {
        throw new Error('email unavailable');
      });

      engine.sendReminders();

      expect(engine.runtime.MailApp.sendEmail).toHaveBeenCalled();
      expect(chatPostChannels(engine)).not.toContain('C123');
      expect(store.sheets.sessions.rows[0][10]).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
