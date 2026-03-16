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
