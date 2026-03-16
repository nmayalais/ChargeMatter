import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

// Mock drizzle-orm operators to return simple marker objects
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  lte: vi.fn((_col, val) => ({ op: 'lte', val })),
  gte: vi.fn((_col, val) => ({ op: 'gte', val })),
}));

import { getActiveSuspensionForUser, assertNotSuspended } from '@/lib/auth-helpers';
import { db } from '@/lib/db';

function makeSuspension(overrides: Record<string, unknown> = {}) {
  return {
    id: 'susp-1',
    userId: 'user@example.com',
    userName: 'Test User',
    startAt: new Date('2026-03-14T00:00:00Z'),
    endAt: new Date('2026-03-17T00:00:00Z'),
    reason: 'Two-strike rule',
    active: true,
    createdAt: new Date('2026-03-14T00:00:00Z'),
    ...overrides,
  };
}

// Build the full chained mock: db.select().from(...).where(...).limit(...)
function mockDbChain(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromFn });
}

describe('getActiveSuspensionForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns suspension when one exists', async () => {
    const suspension = makeSuspension();
    mockDbChain([suspension]);
    const result = await getActiveSuspensionForUser('user@example.com');
    expect(result).toEqual(suspension);
  });

  it('returns null when no suspension exists', async () => {
    mockDbChain([]);
    const result = await getActiveSuspensionForUser('clean@example.com');
    expect(result).toBeNull();
  });
});

describe('assertNotSuspended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw when user is not suspended', async () => {
    mockDbChain([]);
    await expect(assertNotSuspended('clean@example.com')).resolves.toBeUndefined();
  });

  it('throws when user is suspended', async () => {
    const suspension = makeSuspension();
    mockDbChain([suspension]);
    await expect(assertNotSuspended('user@example.com')).rejects.toThrow(
      /Charging privileges suspended/,
    );
  });
});
