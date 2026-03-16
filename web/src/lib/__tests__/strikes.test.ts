import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbInsertValues = vi.fn().mockResolvedValue(undefined);
const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));

// Track ordered results for select queries.
// recordStrike makes 2 selects:
//   1. De-duplicate check: select().from(strikes).where(...).limit(1)
//   2. Monthly count: select().from(strikes).where(...) [no limit, awaited directly]
let selectCallIndex = 0;
let selectResults: unknown[][] = [];

function makeSelectChain(result: unknown[]) {
  // Return an object that supports both `.limit()` and direct `await`
  const thenable = {
    limit: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => void) => Promise.resolve(result).catch(reject),
  };
  return thenable;
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const idx = selectCallIndex++;
          const result = selectResults[idx] ?? [];
          return makeSelectChain(result);
        }),
      })),
    })),
    insert: (...args: unknown[]) => (mockDbInsert as (...a: unknown[]) => unknown)(...args),
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

const mockGetActiveSuspensionForUser = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/auth-helpers', () => ({
  getActiveSuspensionForUser: (...args: unknown[]) => mockGetActiveSuspensionForUser(...args),
}));

const mockNotifyChannel = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/notifications', () => ({
  notifyChannel: (...args: unknown[]) => mockNotifyChannel(...args),
}));

import { recordStrike, maybeApplySuspension } from '@/lib/strikes';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Record<string, string> = {
  app_name: 'EV Charging',
  slack_bot_token: '',
  slack_webhook_url: '',
  slack_webhook_channel: '',
  slack_channel_name: 'ev-charging',
  strike_threshold: '2',
  suspension_business_days: '2',
};

beforeEach(() => {
  vi.clearAllMocks();
  selectCallIndex = 0;
  selectResults = [[], []]; // default: no duplicates, no prior strikes
  mockGetConfig.mockResolvedValue(DEFAULT_CONFIG);
  mockGetActiveSuspensionForUser.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// recordStrike
// ---------------------------------------------------------------------------

describe('recordStrike', () => {
  it('inserts a new strike row', async () => {
    // Call 0 (dedup): no match; Call 1 (monthly count): no prior strikes
    selectResults = [[], []];

    const result = await recordStrike({
      userId: 'user@example.com',
      userName: 'Test User',
      type: 'late',
      sourceType: 'session',
      sourceId: 'S1',
      reason: 'Late move after grace period',
      occurredAt: new Date('2026-03-15T10:00:00'),
    });

    expect(result).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user@example.com',
        type: 'late',
        sourceType: 'session',
        sourceId: 'S1',
        monthKey: '2026-03',
      }),
    );
  });

  it('returns false for duplicate strike (same source_id + type)', async () => {
    // Call 0 (dedup): found existing
    selectResults = [[{ id: 'existing-strike' }]];

    const result = await recordStrike({
      userId: 'user@example.com',
      userName: 'Test User',
      type: 'late',
      sourceType: 'session',
      sourceId: 'S1',
      reason: 'Late move after grace period',
      occurredAt: new Date('2026-03-15T10:00:00'),
    });

    expect(result).toBe(false);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('triggers suspension when strike count reaches threshold', async () => {
    // Call 0 (dedup): no match; Call 1 (monthly count): 2 strikes (= threshold)
    selectResults = [[], [{ id: 'strike-1' }, { id: 'strike-2' }]];

    const result = await recordStrike({
      userId: 'user@example.com',
      userName: 'Test User',
      type: 'no_show',
      sourceType: 'reservation',
      sourceId: 'R1',
      reason: 'No-show for reservation',
      occurredAt: new Date('2026-03-15T10:00:00'),
    });

    expect(result).toBe(true);
    // Should insert strike + suspension (2 inserts)
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
  });

  it('does not trigger suspension when below threshold', async () => {
    // Call 0 (dedup): no match; Call 1 (monthly count): 1 strike (< threshold of 2)
    selectResults = [[], [{ id: 'strike-1' }]];

    const result = await recordStrike({
      userId: 'user@example.com',
      userName: 'Test User',
      type: 'late',
      sourceType: 'session',
      sourceId: 'S1',
      reason: 'Late move',
      occurredAt: new Date('2026-03-15T10:00:00'),
    });

    expect(result).toBe(true);
    // Only 1 insert (the strike), no suspension
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// maybeApplySuspension
// ---------------------------------------------------------------------------

describe('maybeApplySuspension', () => {
  it('creates suspension when strike count meets threshold', async () => {
    const result = await maybeApplySuspension(
      'user@example.com',
      'Test User',
      new Date('2026-03-15T10:00:00'),
      2,
    );

    expect(result).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user@example.com',
        reason: 'Two-strike rule',
        active: true,
      }),
    );
    expect(mockNotifyChannel).toHaveBeenCalled();
  });

  it('does not create suspension when below threshold', async () => {
    const result = await maybeApplySuspension(
      'user@example.com',
      'Test User',
      new Date('2026-03-15T10:00:00'),
      1,
    );

    expect(result).toBe(false);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('does not create suspension if user already suspended', async () => {
    mockGetActiveSuspensionForUser.mockResolvedValueOnce({
      id: 'existing-suspension',
      userId: 'user@example.com',
      active: true,
    });

    const result = await maybeApplySuspension(
      'user@example.com',
      'Test User',
      new Date('2026-03-15T10:00:00'),
      2,
    );

    expect(result).toBe(false);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('calculates correct business days end date (skips weekends)', async () => {
    // 2026-03-13 is a Friday. +2 business days = Tuesday 2026-03-17
    const result = await maybeApplySuspension(
      'user@example.com',
      'Test User',
      new Date('2026-03-13T10:00:00'), // Friday
      2,
    );

    expect(result).toBe(true);
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        startAt: new Date('2026-03-13T10:00:00'),
        endAt: new Date('2026-03-17T10:00:00'), // Tuesday (skip Sat, Sun)
      }),
    );
  });
});
