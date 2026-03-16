import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Auth, Charger, Session, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the db module
const mockDbWhere = vi.fn().mockReturnThis();
const mockDbReturning = vi.fn().mockResolvedValue([{ id: 'NEW-SESSION-ID' }]);
const mockDbSelectLimit = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockDbSelectLimit,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: mockDbWhere,
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockDbReturning,
      })),
    })),
  },
}));

// Mock queries module
const mockGetChargers = vi.fn<() => Promise<Charger[]>>();
const mockGetAllSessions = vi.fn<() => Promise<Session[]>>();
const mockGetAllReservations = vi.fn<() => Promise<Reservation[]>>();
const mockGetActiveSessions = vi.fn<() => Promise<Session[]>>();

vi.mock('@/lib/queries', () => ({
  getChargers: (...args: unknown[]) => mockGetChargers(...(args as [])),
  getAllSessions: (...args: unknown[]) => mockGetAllSessions(...(args as [])),
  getAllReservations: (...args: unknown[]) => mockGetAllReservations(...(args as [])),
  getActiveSessions: (...args: unknown[]) => mockGetActiveSessions(...(args as [])),
}));

// Mock config module
const mockGetConfig = vi.fn<() => Promise<Record<string, string>>>();

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    getConfig: (...args: unknown[]) => mockGetConfig(...(args as [])),
  };
});

// Mock auth-helpers
const mockAssertNotSuspended = vi.fn<(email: string) => Promise<void>>();
const mockGetActiveSuspensionForUser = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/auth-helpers', () => ({
  assertNotSuspended: (email: string) => mockAssertNotSuspended(email),
  getActiveSuspensionForUser: (...args: unknown[]) =>
    mockGetActiveSuspensionForUser(...args),
}));

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeCharger(overrides: Partial<Charger> = {}): Charger {
  return {
    id: 'C1',
    name: 'Charger 1',
    maxMinutes: 60,
    slotStarts: '8:00,9:00,10:00',
    activeSessionId: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'S1',
    chargerId: 'C1',
    userId: 'user@example.com',
    userName: 'User',
    startTime: new Date('2026-03-15T08:00:00'),
    endTime: new Date('2026-03-15T09:00:00'),
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

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'R1',
    chargerId: 'C1',
    userId: 'user@example.com',
    userName: 'User',
    startTime: new Date('2026-03-15T09:00:00'),
    endTime: new Date('2026-03-15T10:00:00'),
    status: 'active',
    checkedInAt: null,
    noShowAt: null,
    noShowStrikeAt: null,
    reminder5BeforeSent: false,
    reminder5AfterSent: false,
    createdAt: new Date('2026-03-14T12:00:00'),
    updatedAt: new Date('2026-03-14T12:00:00'),
    canceledAt: null,
    releasedEarly: false,
    ...overrides,
  };
}

function makeAuth(overrides: Partial<Auth> = {}): Auth {
  return {
    email: 'user@example.com',
    name: 'Test User',
    isAdmin: false,
    ...overrides,
  };
}

const DEFAULT_CONFIG: Record<string, string> = {
  app_name: 'EV Charging',
  slack_channel_name: 'ev-charging',
  slack_channel_url: '',
  overdue_repeat_minutes: '15',
  session_move_grace_minutes: '10',
  suspension_business_days: '2',
  reservation_advance_days: '0',
  reservation_max_upcoming: '1',
  reservation_max_per_day: '1',
  reservation_gap_minutes: '1',
  reservation_rounding_minutes: '15',
  reservation_checkin_early_minutes: '0',
  reservation_early_start_minutes: '15',
  reservation_late_grace_minutes: '30',
  reservation_open_hour: '5',
  reservation_open_minute: '45',
  walkup_net_new_window_minutes: '10',
  walkup_returning_window_minutes: '10',
  force_end_on_checkin_enabled: 'true',
  reminder_10_enabled: 'false',
  reminder_5_enabled: 'false',
  admin_emails: '',
  allowed_domain: 'example.com',
  slack_webhook_url: '',
  slack_webhook_channel: '',
  slack_bot_token: '',
  strike_threshold: '2',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockAssertNotSuspended.mockResolvedValue(undefined);
  mockGetActiveSuspensionForUser.mockResolvedValue(null);
  mockGetConfig.mockResolvedValue({ ...DEFAULT_CONFIG });
  mockGetChargers.mockResolvedValue([makeCharger()]);
  mockGetAllSessions.mockResolvedValue([]);
  mockGetAllReservations.mockResolvedValue([]);
  mockGetActiveSessions.mockResolvedValue([]);
  mockDbReturning.mockResolvedValue([{ id: 'NEW-SESSION-ID' }]);
});

// ---------------------------------------------------------------------------
// Import the module under test (after mocks)
// ---------------------------------------------------------------------------

import {
  startSession,
  endSession,
  endMyActiveSession,
  completeReservationForSession,
} from '@/actions/sessions';

// ---------------------------------------------------------------------------
// Tests: startSession
// ---------------------------------------------------------------------------

describe('startSession', () => {
  it('should create a session on an available charger', async () => {
    // Charger is available, no sessions, no reservations, time is within a slot
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));

    const auth = makeAuth();
    const result = await startSession('C1', auth);

    // Should return board data
    expect(result).toHaveProperty('chargers');
    expect(result).toHaveProperty('serverTime');
    expect(result).toHaveProperty('user');
  });

  it('should throw if charger not found', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    const auth = makeAuth();

    await expect(startSession('NONEXISTENT', auth)).rejects.toThrow(
      'Charger not found.',
    );
  });

  it('should throw if charger is already in use', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    const existingSession = makeSession({ id: 'S-EXISTING' });
    mockGetChargers.mockResolvedValue([
      makeCharger({ activeSessionId: 'S-EXISTING' }),
    ]);
    mockGetAllSessions.mockResolvedValue([existingSession]);

    const auth = makeAuth({ email: 'another@example.com' });
    await expect(startSession('C1', auth)).rejects.toThrow(
      'Charger is already in use.',
    );
  });

  it('should throw if user is suspended', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    mockAssertNotSuspended.mockRejectedValue(
      new Error('Charging privileges suspended until 5:00 PM on Mar 16, 2026.'),
    );

    const auth = makeAuth();
    await expect(startSession('C1', auth)).rejects.toThrow(
      'Charging privileges suspended',
    );
  });

  it('should throw if user already has an active session', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    const existingSession = makeSession({
      id: 'S-OTHER',
      chargerId: 'C2',
    });
    mockGetAllSessions.mockResolvedValue([existingSession]);
    mockGetChargers.mockResolvedValue([
      makeCharger(),
      makeCharger({ id: 'C2', name: 'Charger 2' }),
    ]);

    const auth = makeAuth();
    await expect(startSession('C1', auth)).rejects.toThrow(
      'You already have an active session on Charger 2',
    );
  });

  it('should throw if time is outside scheduled blocks', async () => {
    // 7:00 AM is before the first slot at 8:00
    vi.setSystemTime(new Date('2026-03-15T07:00:00'));

    const auth = makeAuth();
    await expect(startSession('C1', auth)).rejects.toThrow(
      'Charging is only available during scheduled blocks.',
    );
  });

  it('should throw during net-new window for non-net-new users', async () => {
    // Slot at 8:00 has a live reservation by another user.
    // lateGraceMinutes = 30, so openAt = 8:30.
    // netNewWindowMinutes = 10, so allUsersOpenAt = 8:40.
    // Time is 8:35 — only net-new users allowed.
    vi.setSystemTime(new Date('2026-03-15T08:35:00'));

    const liveReservation = makeReservation({
      id: 'R-LIVE',
      chargerId: 'C1',
      userId: 'other@example.com',
      startTime: new Date('2026-03-15T08:00:00'),
      endTime: new Date('2026-03-15T09:00:00'),
      status: 'active',
    });

    // User has a prior session today → not net-new
    const priorSession = makeSession({
      id: 'S-PRIOR',
      chargerId: 'C2',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T07:00:00'),
      endTime: new Date('2026-03-15T08:00:00'),
      status: 'complete',
      complete: true,
      active: false,
    });

    mockGetAllReservations.mockResolvedValue([liveReservation]);
    mockGetAllSessions.mockResolvedValue([priorSession]);

    const auth = makeAuth();
    await expect(startSession('C1', auth)).rejects.toThrow(
      'first-time drivers today',
    );
  });

  it('should throw if user has a conflicting reservation on another charger', async () => {
    vi.setSystemTime(new Date('2026-03-15T09:30:00'));

    const conflicting = makeReservation({
      id: 'R-CONFLICT',
      chargerId: 'C2',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });

    mockGetAllReservations.mockResolvedValue([conflicting]);
    mockGetChargers.mockResolvedValue([
      makeCharger(),
      makeCharger({ id: 'C2', name: 'Charger 2' }),
    ]);

    const auth = makeAuth();
    await expect(startSession('C1', auth)).rejects.toThrow(
      'You already have a reservation on Charger 2',
    );
  });

  it('should throw if charger max_minutes is not configured', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    mockGetChargers.mockResolvedValue([makeCharger({ maxMinutes: 0 })]);

    const auth = makeAuth();
    await expect(startSession('C1', auth)).rejects.toThrow(
      'Charger max minutes is not configured.',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: endSession
// ---------------------------------------------------------------------------

describe('endSession', () => {
  it('should end a session owned by the user', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));

    const session = makeSession();
    // endSessionInternal does a db.select to find the session
    mockDbSelectLimit.mockResolvedValueOnce([session]);

    const auth = makeAuth();
    const result = await endSession('S1', auth);

    expect(result).toHaveProperty('chargers');
    expect(result).toHaveProperty('serverTime');
  });

  it('should throw if non-owner non-admin tries to end session', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));

    const session = makeSession({ userId: 'owner@example.com' });
    mockDbSelectLimit.mockResolvedValueOnce([session]);

    const auth = makeAuth({ email: 'other@example.com', isAdmin: false });
    await expect(endSession('S1', auth)).rejects.toThrow(
      'You can only end your own session.',
    );
  });

  it('should allow admin to end any session', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));

    const session = makeSession({ userId: 'owner@example.com' });
    mockDbSelectLimit.mockResolvedValueOnce([session]);
    // Second select for charger lookup in endSessionInternal
    mockDbSelectLimit.mockResolvedValueOnce([makeCharger({ activeSessionId: 'S1' })]);

    const auth = makeAuth({
      email: 'admin@example.com',
      isAdmin: true,
    });
    const result = await endSession('S1', auth, true);

    expect(result).toHaveProperty('chargers');
  });

  it('should throw if session not found', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    mockDbSelectLimit.mockResolvedValueOnce([]);

    const auth = makeAuth();
    await expect(endSession('NONEXISTENT', auth)).rejects.toThrow(
      'Session not found.',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: endMyActiveSession
// ---------------------------------------------------------------------------

describe('endMyActiveSession', () => {
  it('should find and end the user\'s active session', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));

    const session = makeSession();
    mockGetActiveSessions.mockResolvedValue([session]);
    // endSessionInternal does a db select for the session
    mockDbSelectLimit.mockResolvedValueOnce([session]);

    const auth = makeAuth();
    const result = await endMyActiveSession(auth);

    expect(result).toHaveProperty('chargers');
  });

  it('should throw if user has no active session', async () => {
    vi.setSystemTime(new Date('2026-03-15T08:30:00'));
    mockGetActiveSessions.mockResolvedValue([]);

    const auth = makeAuth();
    await expect(endMyActiveSession(auth)).rejects.toThrow(
      'Active session not found.',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: completeReservationForSession
// ---------------------------------------------------------------------------

describe('completeReservationForSession', () => {
  it('should mark a checked-in reservation as complete', async () => {
    const session = makeSession({
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });

    const reservation = makeReservation({
      id: 'R1',
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
      status: 'checked_in',
      checkedInAt: new Date('2026-03-15T09:00:00'),
    });

    const { db } = await import('@/lib/db');
    const mockUpdate = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    }));
    (db.update as ReturnType<typeof vi.fn>) = mockUpdate;

    const now = new Date('2026-03-15T09:50:00');
    await completeReservationForSession(session, now, [reservation]);

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('should set released_early when session ends before halfway point', async () => {
    const session = makeSession({
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });

    const reservation = makeReservation({
      id: 'R1',
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
      status: 'checked_in',
      checkedInAt: new Date('2026-03-15T09:00:00'),
    });

    let capturedSet: Record<string, unknown> = {};
    const { db } = await import('@/lib/db');
    const mockUpdate = vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        capturedSet = data;
        return { where: vi.fn() };
      }),
    }));
    (db.update as ReturnType<typeof vi.fn>) = mockUpdate;

    // Halfway point is 9:30. Ending at 9:15 = before halfway = released_early = true
    const now = new Date('2026-03-15T09:15:00');
    await completeReservationForSession(session, now, [reservation]);

    expect(capturedSet.releasedEarly).toBe(true);
    expect(capturedSet.status).toBe('complete');
  });

  it('should NOT set released_early when session ends after halfway point', async () => {
    const session = makeSession({
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });

    const reservation = makeReservation({
      id: 'R1',
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
      status: 'checked_in',
      checkedInAt: new Date('2026-03-15T09:00:00'),
    });

    let capturedSet: Record<string, unknown> = {};
    const { db } = await import('@/lib/db');
    const mockUpdate = vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        capturedSet = data;
        return { where: vi.fn() };
      }),
    }));
    (db.update as ReturnType<typeof vi.fn>) = mockUpdate;

    // Halfway point is 9:30. Ending at 9:45 = after halfway = released_early = false
    const now = new Date('2026-03-15T09:45:00');
    await completeReservationForSession(session, now, [reservation]);

    expect(capturedSet.releasedEarly).toBe(false);
    expect(capturedSet.status).toBe('complete');
  });

  it('should skip reservations that are not checked in', async () => {
    const session = makeSession({
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });

    const reservation = makeReservation({
      id: 'R1',
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
      status: 'active',
      checkedInAt: null, // Not checked in
    });

    const { db } = await import('@/lib/db');
    const mockUpdate = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    }));
    (db.update as ReturnType<typeof vi.fn>) = mockUpdate;

    const now = new Date('2026-03-15T09:15:00');
    await completeReservationForSession(session, now, [reservation]);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should skip reservations on different chargers', async () => {
    const session = makeSession({
      chargerId: 'C1',
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
    });

    const reservation = makeReservation({
      id: 'R1',
      chargerId: 'C2', // Different charger
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00'),
      endTime: new Date('2026-03-15T10:00:00'),
      status: 'checked_in',
      checkedInAt: new Date('2026-03-15T09:00:00'),
    });

    const { db } = await import('@/lib/db');
    const mockUpdate = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    }));
    (db.update as ReturnType<typeof vi.fn>) = mockUpdate;

    const now = new Date('2026-03-15T09:15:00');
    await completeReservationForSession(session, now, [reservation]);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
