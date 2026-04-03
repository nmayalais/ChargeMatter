import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the db module
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  not: vi.fn((arg: unknown) => ({ op: 'not', arg })),
  inArray: vi.fn((_col, vals) => ({ op: 'inArray', vals })),
  lte: vi.fn((_col, val) => ({ op: 'lte', val })),
  gte: vi.fn((_col, val) => ({ op: 'gte', val })),
}));

// Mock getConfig to return admin_emails
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

// Mock getBoardData to avoid full board construction
vi.mock('@/actions/board', () => ({
  getBoardData: vi.fn(),
}));

// Mock notifications
vi.mock('@/lib/notifications', () => ({
  notifyChannel: vi.fn(),
  notifyUser: vi.fn(),
  buildMoveCarMessage: vi.fn(
    (appName: string, chargerName: string, channelMention: string) =>
      `${appName}: Someone is waiting for ${chargerName}. Please move your car and post any delays in ${channelMention}.`,
  ),
  getSlackChannelMention: vi.fn((name: string) => (name ? `#${name}` : 'the Slack channel')),
}));

import { resetCharger, forceEndSession, notifyOwner } from '@/actions/admin';
import { getConfig } from '@/lib/config';
import { getBoardData } from '@/actions/board';
import { notifyChannel, notifyUser } from '@/lib/notifications';
import type { Auth } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adminAuth: Auth = {
  email: 'admin@example.com',
  name: 'Admin User',
  isAdmin: true,
};

const nonAdminAuth: Auth = {
  email: 'user@example.com',
  name: 'Regular User',
  isAdmin: false,
};

const mockConfigMap: Record<string, string> = {
  admin_emails: 'admin@example.com',
  app_name: 'EV Charging',
  slack_channel_name: 'ev-charging',
  slack_bot_token: '',
  slack_webhook_url: '',
  slack_webhook_channel: '',
};

const mockBoardData = {
  user: adminAuth,
  chargers: [],
  reservations: [],
  serverTime: new Date().toISOString(),
  timezone: 'America/Chicago',
  config: {},
};

function makeCharger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'charger-1',
    name: 'Charger A',
    maxMinutes: 240,
    slotStarts: '06:00,10:00,14:00',
    activeSessionId: null,
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    chargerId: 'charger-1',
    userId: 'driver@example.com',
    userName: 'Driver',
    startTime: new Date('2026-03-15T10:00:00Z'),
    endTime: new Date('2026-03-15T14:00:00Z'),
    status: 'active',
    active: true,
    overdue: false,
    complete: false,
    reminder10Sent: false,
    reminder5Sent: false,
    reminder0Sent: false,
    overdueLastSentAt: null,
    graceNotifiedAt: null,
    lateStrikeAt: null,
    endedAt: null,
    ...overrides,
  };
}

/**
 * Set up the mock chains for db.select() and db.update().
 *
 * selectResults is an array of result arrays, one per select() call in order.
 */
function setupDbMocks(selectResults: unknown[][]) {
  let selectIdx = 0;
  mockSelect.mockImplementation(() => {
    const results = selectResults[selectIdx] ?? [];
    selectIdx++;
    const whereFn = vi.fn().mockResolvedValue(results);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    return { from: fromFn };
  });

  mockUpdate.mockImplementation(() => {
    const whereFn = vi.fn().mockResolvedValue({ rowCount: 1 });
    const setFn = vi.fn().mockReturnValue({ where: whereFn });
    return { set: setFn };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getConfig as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfigMap);
  (getBoardData as ReturnType<typeof vi.fn>).mockResolvedValue(mockBoardData);
});

// ---------------------------------------------------------------------------
// resetCharger
// ---------------------------------------------------------------------------

describe('resetCharger', () => {
  it('resets a charger with an active session — marks session complete and clears charger', async () => {
    const charger = makeCharger({ activeSessionId: 'session-1' });
    const session = makeSession();

    // select 1: charger lookup, select 2: session lookup
    setupDbMocks([[charger], [session]]);

    const result = await resetCharger('charger-1', adminAuth);

    expect(result).toEqual(mockBoardData);
    // Should have called update twice: once for session, once for charger
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('resets a charger with no active session — clears charger only', async () => {
    const charger = makeCharger({ activeSessionId: null });

    // select 1: charger lookup
    setupDbMocks([[charger]]);

    const result = await resetCharger('charger-1', adminAuth);

    expect(result).toEqual(mockBoardData);
    // Should have called update once: only for charger
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('throws when charger is not found', async () => {
    setupDbMocks([[]]);

    await expect(resetCharger('nonexistent', adminAuth)).rejects.toThrow('Charger not found.');
  });

  it('throws when called by a non-admin', async () => {
    await expect(resetCharger('charger-1', nonAdminAuth)).rejects.toThrow('Admin access required.');
  });

  it('throws when not authenticated', async () => {
    const noAuth: Auth = { email: '', name: '', isAdmin: false };
    await expect(resetCharger('charger-1', noAuth)).rejects.toThrow('Not authenticated');
  });
});

// ---------------------------------------------------------------------------
// forceEndSession
// ---------------------------------------------------------------------------

describe('forceEndSession', () => {
  it('force-ends an active session as admin', async () => {
    const charger = makeCharger({ activeSessionId: 'session-1' });
    const session = makeSession();

    setupDbMocks([[charger], [session]]);

    const result = await forceEndSession('charger-1', adminAuth);

    expect(result).toEqual(mockBoardData);
    // Should have called update twice: session complete + charger clear
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('returns board when charger has no active session', async () => {
    const charger = makeCharger({ activeSessionId: null });

    setupDbMocks([[charger]]);

    const result = await forceEndSession('charger-1', adminAuth);

    expect(result).toEqual(mockBoardData);
    // No updates needed
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns board when charger is not found', async () => {
    setupDbMocks([[]]);

    const result = await forceEndSession('nonexistent', adminAuth);

    expect(result).toEqual(mockBoardData);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws when called by a non-admin', async () => {
    await expect(forceEndSession('charger-1', nonAdminAuth)).rejects.toThrow(
      'Admin access required.',
    );
  });
});

// ---------------------------------------------------------------------------
// notifyOwner
// ---------------------------------------------------------------------------

describe('notifyOwner', () => {
  it('sends notification to the session owner', async () => {
    const charger = makeCharger({ activeSessionId: 'session-1' });
    const session = makeSession({ userId: 'driver@example.com' });

    setupDbMocks([[charger], [session]]);
    (notifyUser as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (notifyChannel as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await notifyOwner('charger-1', nonAdminAuth);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Notification sent to the session owner.');
    // Owner gets a DM with the full message
    expect(notifyUser).toHaveBeenCalledWith(
      expect.stringContaining('Someone is waiting for Charger A'),
      expect.objectContaining({ appName: 'EV Charging' }),
      'driver@example.com',
    );
    // Channel gets a brief mention-free note
    expect(notifyChannel).toHaveBeenCalledWith(
      expect.stringContaining('A request was sent to move a car at Charger A'),
      expect.objectContaining({ appName: 'EV Charging' }),
    );
  });

  it('returns failure message when notification fails', async () => {
    const charger = makeCharger({ activeSessionId: 'session-1' });
    const session = makeSession();

    setupDbMocks([[charger], [session]]);
    (notifyUser as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (notifyChannel as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await notifyOwner('charger-1', nonAdminAuth);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unable to send notification');
  });

  it('throws when charger has no active session', async () => {
    const charger = makeCharger({ activeSessionId: null });
    setupDbMocks([[charger]]);

    await expect(notifyOwner('charger-1', nonAdminAuth)).rejects.toThrow(
      'No active session for this charger.',
    );
  });

  it('throws when session is not found', async () => {
    const charger = makeCharger({ activeSessionId: 'session-1' });
    setupDbMocks([[charger], []]);

    await expect(notifyOwner('charger-1', nonAdminAuth)).rejects.toThrow('Session not found.');
  });

  it('throws when not authenticated', async () => {
    const noAuth: Auth = { email: '', name: '', isAdmin: false };
    await expect(notifyOwner('charger-1', noAuth)).rejects.toThrow('Not authenticated');
  });
});
