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
    properties: { SPREADSHEET_ID: 'local' },
    sheets: {
      chargers: {
        headers: CHARGERS_HEADERS,
        rows: [
          ['1', 'Charger 1', 60, '06:00,07:00,08:00', 'session-1'],
          ['2', 'Charger 2', 60, '06:00,07:00,08:00', 'session-2']
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
        headers: CONFIG_HEADERS,
        rows: [
          ['allowed_domain', 'example.com'],
          ['admin_emails', 'admin@example.com']
        ]
      }
    }
  };
}

function createUserEngine(store) {
  return createEngine({
    store,
    authEmail: 'driver@example.com',
    authName: 'Driver',
    isAdmin: false
  });
}

function localDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('Reservation session matching', () => {
  test('ends active session when it matches reservation window and charger', () => {
    const store = buildStore();
    const start = localDate(2026, 2, 9, 7, 30);
    const end = localDate(2026, 2, 9, 8, 30);
    store.sheets.reservations.rows.push([
      'res-1',
      '1',
      'driver@example.com',
      'Driver',
      start,
      end,
      'checked_in',
      localDate(2026, 2, 9, 7, 25),
      '',
      '',
      '',
      '',
      localDate(2026, 2, 9, 7, 0),
      localDate(2026, 2, 9, 7, 25),
      '',
      ''
    ]);
    store.sheets.sessions.rows.push([
      'session-1',
      '1',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 7, 20),
      localDate(2026, 2, 9, 8, 20),
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

    const engine = createUserEngine(store);
    engine.endSessionForReservation('res-1');

    const sessionRow = store.sheets.sessions.rows.find((row) => row[0] === 'session-1');
    expect(sessionRow[6]).toBe('complete');
    expect(sessionRow[9]).toBe(true);
  });

  test('fails when no active session exists', () => {
    const store = buildStore();
    store.sheets.reservations.rows.push([
      'res-2',
      '1',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 7, 30),
      localDate(2026, 2, 9, 8, 30),
      'checked_in',
      localDate(2026, 2, 9, 7, 25),
      '',
      '',
      '',
      '',
      localDate(2026, 2, 9, 7, 0),
      localDate(2026, 2, 9, 7, 25),
      '',
      ''
    ]);

    const engine = createUserEngine(store);
    expect(() => engine.endSessionForReservation('res-2')).toThrow('Session not found for this reservation.');
  });

  test('fails when active session is on a different charger', () => {
    const store = buildStore();
    store.sheets.reservations.rows.push([
      'res-3',
      '1',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 7, 30),
      localDate(2026, 2, 9, 8, 30),
      'checked_in',
      localDate(2026, 2, 9, 7, 25),
      '',
      '',
      '',
      '',
      localDate(2026, 2, 9, 7, 0),
      localDate(2026, 2, 9, 7, 25),
      '',
      ''
    ]);
    store.sheets.sessions.rows.push([
      'session-2',
      '2',
      'driver@example.com',
      'Driver',
      localDate(2026, 2, 9, 7, 20),
      localDate(2026, 2, 9, 8, 20),
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

    const engine = createUserEngine(store);
    expect(() => engine.endSessionForReservation('res-3')).toThrow('Session does not match this reservation.');
  });
});
