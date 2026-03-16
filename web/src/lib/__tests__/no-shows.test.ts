import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Charger, Reservation } from '@/types';

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

const mockGetActiveReservations = vi.fn<() => Promise<Reservation[]>>();
const mockGetChargers = vi.fn<() => Promise<Charger[]>>();

vi.mock('@/lib/queries', () => ({
  getActiveReservations: (...args: unknown[]) => mockGetActiveReservations(...(args as [])),
  getChargers: (...args: unknown[]) => mockGetChargers(...(args as [])),
}));

const mockRecordStrike = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/strikes', () => ({
  recordStrike: (...args: unknown[]) => mockRecordStrike(...args),
}));

const mockNotifyChannel = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/notifications', () => ({
  notifyChannel: (...args: unknown[]) => mockNotifyChannel(...args),
}));

import { processNoShows } from '@/lib/no-shows';

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
  reservation_late_grace_minutes: '30',
  strike_threshold: '2',
  suspension_business_days: '2',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockResolvedValue(DEFAULT_CONFIG);
  mockGetChargers.mockResolvedValue([makeCharger()]);
  mockGetActiveReservations.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processNoShows', () => {
  it('marks reservation as no-show when past grace period', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    // Now is 31 minutes after start (grace period = 30 min)
    const now = new Date('2026-03-15T09:31:00');
    const result = await processNoShows(now);

    expect(result.noShowCount).toBe(1);
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'no_show',
        noShowAt: now,
        noShowStrikeAt: now,
      }),
    );
  });

  it('records a no-show strike', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    const now = new Date('2026-03-15T09:31:00');
    await processNoShows(now);

    expect(mockRecordStrike).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'no_show',
        sourceType: 'reservation',
        sourceId: 'R1',
        userId: 'user@example.com',
      }),
    );
  });

  it('does not mark reservation within grace period', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    // Now is 29 minutes after start (within 30 min grace)
    const now = new Date('2026-03-15T09:29:00');
    const result = await processNoShows(now);

    expect(result.noShowCount).toBe(0);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockRecordStrike).not.toHaveBeenCalled();
  });

  it('skips already checked-in reservation', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
      checkedInAt: new Date('2026-03-15T09:05:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    const now = new Date('2026-03-15T09:31:00');
    const result = await processNoShows(now);

    expect(result.noShowCount).toBe(0);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('skips canceled reservation', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
      status: 'canceled',
      canceledAt: new Date('2026-03-15T08:00:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    const now = new Date('2026-03-15T09:31:00');
    const result = await processNoShows(now);

    expect(result.noShowCount).toBe(0);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('skips reservation already marked as no_show', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
      status: 'no_show',
      noShowAt: new Date('2026-03-15T09:30:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    const now = new Date('2026-03-15T09:35:00');
    const result = await processNoShows(now);

    expect(result.noShowCount).toBe(0);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('sends notification when marking no-show', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    const now = new Date('2026-03-15T09:31:00');
    await processNoShows(now);

    expect(mockNotifyChannel).toHaveBeenCalledWith(
      expect.stringContaining('no-show after 30 minutes'),
      expect.any(Object),
      'user@example.com',
    );
  });

  it('does not re-record strike if noShowStrikeAt already set', async () => {
    const reservation = makeReservation({
      startTime: new Date('2026-03-15T09:00:00'),
      noShowStrikeAt: new Date('2026-03-15T09:30:00'),
    });
    mockGetActiveReservations.mockResolvedValue([reservation]);

    const now = new Date('2026-03-15T09:31:00');
    await processNoShows(now);

    expect(mockRecordStrike).not.toHaveBeenCalled();
  });
});
