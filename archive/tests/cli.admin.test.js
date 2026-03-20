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

function buildStore() {
  return {
    properties: {
      SPREADSHEET_ID: 'local'
    },
    sheets: {
      chargers: {
        headers: CHARGERS_HEADERS,
        rows: [['1', 'Charger 1', 60, '06:00,07:00,08:00', 'session-1']]
      },
      sessions: {
        headers: SESSIONS_HEADERS,
        rows: [
          [
            'session-1',
            '1',
            'driver@example.com',
            'Driver',
            new Date(),
            new Date(Date.now() + 3600000),
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
          ]
        ]
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

describe('Midnight charger reset', () => {
  function buildMidnightStore(chargerRows, sessionRows, reservationRows = []) {
    return {
      properties: { SPREADSHEET_ID: 'local' },
      sheets: {
        chargers: { headers: CHARGERS_HEADERS, rows: chargerRows },
        sessions: { headers: SESSIONS_HEADERS, rows: sessionRows },
        reservations: { headers: RESERVATIONS_HEADERS, rows: reservationRows },
        strikes: { headers: STRIKES_HEADERS, rows: [] },
        suspensions: { headers: SUSPENSIONS_HEADERS, rows: [] },
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

  test('clears active sessions on all chargers', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7200000);
    const end = new Date(now.getTime() - 3600000);
    const store = buildMidnightStore(
      [
        ['1', 'Charger 1', 60, '06:00', 'session-1'],
        ['2', 'Charger 2', 60, '06:00', 'session-2']
      ],
      [
        ['session-1', '1', 'a@example.com', 'A', start, end, 'active', true, true, false, false, false, false, '', '', '', '', ''],
        ['session-2', '2', 'b@example.com', 'B', start, end, 'active', true, false, false, false, false, false, '', '', '', '']
      ]
    );
    const engine = createEngine({ store, authEmail: 'admin@example.com', authName: 'Admin', isAdmin: true });
    engine.resetAllChargersAtMidnight();
    // Both chargers should have no active session
    expect(store.sheets.chargers.rows[0][4] || '').toBe('');
    expect(store.sheets.chargers.rows[1][4] || '').toBe('');
    // Both sessions should be marked complete
    expect(store.sheets.sessions.rows[0][6]).toBe('complete');
    expect(store.sheets.sessions.rows[1][6]).toBe('complete');
  });

  test('handles charger with no active session (no-op)', () => {
    const store = buildMidnightStore(
      [['1', 'Charger 1', 60, '06:00', '']],
      []
    );
    const engine = createEngine({ store, authEmail: 'admin@example.com', authName: 'Admin', isAdmin: true });
    // Should not throw
    engine.resetAllChargersAtMidnight();
    expect(store.sheets.chargers.rows[0][4] || '').toBe('');
  });

  test('handles stale session reference (already complete)', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7200000);
    const end = new Date(now.getTime() - 3600000);
    const store = buildMidnightStore(
      [['1', 'Charger 1', 60, '06:00', 'session-1']],
      [['session-1', '1', 'a@example.com', 'A', start, end, 'complete', false, false, true, false, false, false, '', '', '', end, '']]
    );
    const engine = createEngine({ store, authEmail: 'admin@example.com', authName: 'Admin', isAdmin: true });
    engine.resetAllChargersAtMidnight();
    // Charger active_session_id should be cleared
    expect(store.sheets.chargers.rows[0][4] || '').toBe('');
    // Session status should remain complete (not re-updated)
    expect(store.sheets.sessions.rows[0][6]).toBe('complete');
  });

  test('completes associated checked-in reservations', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7200000);
    const end = new Date(now.getTime() + 3600000);
    const store = buildMidnightStore(
      [['1', 'Charger 1', 60, '06:00', 'session-1']],
      [['session-1', '1', 'a@example.com', 'A', start, end, 'active', true, false, false, false, false, false, '', '', '', '']],
      [['res-1', '1', 'a@example.com', 'A', start, end, 'confirmed', start, '', '', '', '', now, now, '', '']]
    );
    const engine = createEngine({ store, authEmail: 'admin@example.com', authName: 'Admin', isAdmin: true });
    engine.resetAllChargersAtMidnight();
    expect(store.sheets.reservations.rows[0][6]).toBe('complete');
  });

  test('does not send notifications', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7200000);
    const end = new Date(now.getTime() - 3600000);
    const store = buildMidnightStore(
      [['1', 'Charger 1', 60, '06:00', 'session-1']],
      [['session-1', '1', 'a@example.com', 'A', start, end, 'active', true, true, false, false, false, false, '', '', '', '']]
    );
    store.sheets.config.rows.push(['slack_webhook_url', 'https://hooks.example.com/test']);
    const engine = createEngine({ store, authEmail: 'admin@example.com', authName: 'Admin', isAdmin: true });
    const origFetch = engine.runtime.UrlFetchApp.fetch;
    let fetchCallCount = 0;
    engine.runtime.UrlFetchApp.fetch = function () {
      fetchCallCount++;
      return origFetch.apply(this, arguments);
    };
    engine.resetAllChargersAtMidnight();
    // No Slack/email should be sent for midnight cleanup
    expect(fetchCallCount).toBe(0);
  });
});
