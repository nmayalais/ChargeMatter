import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Charger, Session, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbUpdateSetWhere = vi.fn().mockResolvedValue(undefined);
const mockDbUpdateSet = vi.fn(() => ({ where: mockDbUpdateSetWhere }));
const mockDbUpdate = vi.fn(() => ({ set: mockDbUpdateSet }));

vi.mock('@/lib/db', () => ({
  db: {
    update: (...args: unknown[]) => (mockDbUpdate as (...a: unknown[]) => unknown)(...args),
  },
}));

const mockGetConfig = vi.fn<() => Promise<Record<string, string>>>();

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    getConfig: (...args: unknown[]) => mockGetConfig(...(args as [])),
  };
});

const mockGetActiveSessions = vi.fn<() => Promise<Session[]>>();
const mockGetActiveReservations = vi.fn<() => Promise<Reservation[]>>();
const mockGetChargers = vi.fn<() => Promise<Charger[]>>();

vi.mock('@/lib/queries', () => ({
  getActiveSessions: (...args: unknown[]) => mockGetActiveSessions(...(args as [])),
  getActiveReservations: (...args: unknown[]) => mockGetActiveReservations(...(args as [])),
  getChargers: (...args: unknown[]) => mockGetChargers(...(args as [])),
}));

const mockRecordStrike = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/strikes', () => ({
  recordStrike: (...args: unknown[]) => mockRecordStrike(...args),
}));

const mockNotifyChannel = vi.fn().mockResolvedValue(true);
const mockNotifyUser = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/notifications', () => ({
  notifyChannel: (...args: unknown[]) => mockNotifyChannel(...args),
  notifyUser: (...args: unknown[]) => mockNotifyUser(...args),
  getSlackChannelMention: vi.fn((name: string) => `#${name}`),
}));

import { processSessionReminders } from '@/lib/reminders';

// ---------------------------------------------------------------------------
// Factories
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
    userName: 'Test User',
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
    userName: 'Test User',
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

const DEFAULT_CONFIG: Record<string, string> = {
  app_name: 'EV Charging',
  slack_bot_token: '',
  slack_webhook_url: '',
  slack_webhook_channel: '',
  slack_channel_name: 'ev-charging',
  overdue_repeat_minutes: '15',
  session_move_grace_minutes: '10',
  reservation_late_grace_minutes: '30',
  reminder_10_enabled: 'true',
  reminder_5_enabled: 'true',
  strike_threshold: '2',
  suspension_business_days: '2',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockResolvedValue(DEFAULT_CONFIG);
  mockGetChargers.mockResolvedValue([makeCharger()]);
  mockGetActiveSessions.mockResolvedValue([]);
  mockGetActiveReservations.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Session reminder tests
// ---------------------------------------------------------------------------

describe('processSessionReminders', () => {
  describe('10-minute reminder', () => {
    it('sends 10-minute reminder when session has 10 minutes left', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:08:00'), // 8 minutes from now
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders10Sent).toBe(1);
      expect(mockNotifyUser).toHaveBeenCalledWith(
        expect.stringContaining('ends in 10 minutes'),
        expect.any(Object),
        'user@example.com',
      );
    });

    it('does not send 10-minute reminder if already sent', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:08:00'),
        reminder10Sent: true,
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders10Sent).toBe(0);
    });

    it('does not send 10-minute reminder when disabled in config', async () => {
      mockGetConfig.mockResolvedValue({
        ...DEFAULT_CONFIG,
        reminder_10_enabled: 'false',
      });

      const session = makeSession({
        endTime: new Date('2026-03-15T09:08:00'),
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders10Sent).toBe(0);
    });
  });

  describe('5-minute reminder', () => {
    it('sends 5-minute reminder when session has 5 minutes left', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:03:00'), // 3 minutes from now
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders5Sent).toBe(1);
      expect(mockNotifyUser).toHaveBeenCalledWith(
        expect.stringContaining('ends in 5 minutes'),
        expect.any(Object),
        'user@example.com',
      );
    });

    it('does not send 5-minute reminder if already sent', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:03:00'),
        reminder5Sent: true,
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders5Sent).toBe(0);
    });

    it('does not send 5-minute reminder when disabled in config', async () => {
      mockGetConfig.mockResolvedValue({
        ...DEFAULT_CONFIG,
        reminder_5_enabled: 'false',
      });

      const session = makeSession({
        endTime: new Date('2026-03-15T09:03:00'),
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders5Sent).toBe(0);
    });
  });

  describe('0-minute (session ended) reminder', () => {
    it('sends end reminder when session time has passed', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T08:59:00'), // ended 1 minute ago
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders0Sent).toBe(1);
      expect(mockNotifyChannel).toHaveBeenCalledWith(
        expect.stringContaining('just ended'),
        expect.any(Object),
        'user@example.com',
      );
    });

    it('does not re-send end reminder if already sent', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T08:59:00'),
        reminder0Sent: true,
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reminders0Sent).toBe(0);
    });
  });

  describe('overdue session handling', () => {
    it('sends overdue reminder when past grace period', async () => {
      // Session ended at 09:00, grace = 10 min, so overdue at 09:10
      const session = makeSession({
        endTime: new Date('2026-03-15T09:00:00'),
        reminder0Sent: true, // already sent the end reminder
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      // Now is 09:11 — past the 10-minute grace period
      const now = new Date('2026-03-15T09:11:00');
      const result = await processSessionReminders(now);

      expect(result.graceNotifications).toBe(1);
      expect(result.lateStrikes).toBe(1);
    });

    it('records late strike when overdue', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:00:00'),
        reminder0Sent: true,
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:11:00');
      await processSessionReminders(now);

      expect(mockRecordStrike).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'late',
          sourceType: 'session',
          sourceId: 'S1',
        }),
      );
    });

    it('does not record late strike if already recorded', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:00:00'),
        reminder0Sent: true,
        lateStrikeAt: new Date('2026-03-15T09:10:00'),
        graceNotifiedAt: new Date('2026-03-15T09:10:00'),
        overdueLastSentAt: new Date('2026-03-15T09:10:00'),
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:11:00');
      const result = await processSessionReminders(now);

      expect(result.lateStrikes).toBe(0);
      expect(mockRecordStrike).not.toHaveBeenCalled();
    });

    it('sends repeating overdue reminders at configured interval', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:00:00'),
        reminder0Sent: true,
        graceNotifiedAt: new Date('2026-03-15T09:10:00'),
        lateStrikeAt: new Date('2026-03-15T09:10:00'),
        overdueLastSentAt: new Date('2026-03-15T09:10:00'),
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      // Now is 15 minutes after the last sent (overdue_repeat_minutes = 15)
      const now = new Date('2026-03-15T09:25:00');
      const result = await processSessionReminders(now);

      expect(result.overdueReminders).toBe(1);
    });

    it('does not send overdue repeat before interval elapses', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:00:00'),
        reminder0Sent: true,
        graceNotifiedAt: new Date('2026-03-15T09:10:00'),
        lateStrikeAt: new Date('2026-03-15T09:10:00'),
        overdueLastSentAt: new Date('2026-03-15T09:15:00'),
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      // Only 5 minutes since last sent (need 15)
      const now = new Date('2026-03-15T09:20:00');
      const result = await processSessionReminders(now);

      expect(result.overdueReminders).toBe(0);
    });
  });

  describe('early exit', () => {
    it('returns early when no active sessions or pending reservations', async () => {
      mockGetActiveSessions.mockResolvedValue([]);
      mockGetActiveReservations.mockResolvedValue([]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.sessionsProcessed).toBe(0);
      expect(result.reservationsProcessed).toBe(0);
      expect(mockNotifyChannel).not.toHaveBeenCalled();
    });

    it('skips complete sessions', async () => {
      const session = makeSession({
        endTime: new Date('2026-03-15T09:08:00'),
        complete: true,
        status: 'complete',
      });
      mockGetActiveSessions.mockResolvedValue([session]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.sessionsProcessed).toBe(0);
    });
  });

  describe('reservation reminders', () => {
    it('sends upcoming reminder 5 minutes before start', async () => {
      const reservation = makeReservation({
        startTime: new Date('2026-03-15T09:03:00'), // 3 minutes from now
      });
      mockGetActiveReservations.mockResolvedValue([reservation]);
      // Need at least one session or reservation for the function to not early-exit
      mockGetActiveSessions.mockResolvedValue([]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reservationUpcomingReminders).toBe(1);
      expect(mockNotifyUser).toHaveBeenCalledWith(
        expect.stringContaining('starts in 5 minutes'),
        expect.any(Object),
        'user@example.com',
      );
    });

    it('sends late reminder 5 minutes after start when not checked in', async () => {
      const reservation = makeReservation({
        startTime: new Date('2026-03-15T08:50:00'), // started 10 minutes ago
      });
      mockGetActiveReservations.mockResolvedValue([reservation]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reservationLateReminders).toBe(1);
      expect(mockNotifyUser).toHaveBeenCalledWith(
        expect.stringContaining('will be released'),
        expect.any(Object),
        'user@example.com',
      );
    });

    it('skips checked-in reservation', async () => {
      const reservation = makeReservation({
        startTime: new Date('2026-03-15T09:03:00'),
        checkedInAt: new Date('2026-03-15T09:01:00'),
      });
      mockGetActiveReservations.mockResolvedValue([reservation]);

      const now = new Date('2026-03-15T09:00:00');
      const result = await processSessionReminders(now);

      expect(result.reservationUpcomingReminders).toBe(0);
      expect(result.reservationLateReminders).toBe(0);
    });
  });
});
