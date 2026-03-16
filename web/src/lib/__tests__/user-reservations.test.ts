import { describe, it, expect } from 'vitest';
import { getUpcomingReservationsForUser } from '@/lib/user-reservations';
import type { Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'R1',
    chargerId: 'C1',
    userId: 'user@example.com',
    userName: 'User',
    startTime: new Date('2026-03-15T09:00:00Z'),
    endTime: new Date('2026-03-15T10:00:00Z'),
    status: 'active',
    checkedInAt: null,
    noShowAt: null,
    noShowStrikeAt: null,
    reminder5BeforeSent: false,
    reminder5AfterSent: false,
    createdAt: new Date('2026-03-14T12:00:00Z'),
    updatedAt: new Date('2026-03-14T12:00:00Z'),
    canceledAt: null,
    releasedEarly: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getUpcomingReservationsForUser', () => {
  const now = new Date('2026-03-15T08:30:00Z');

  it('returns empty for no reservations', () => {
    const result = getUpcomingReservationsForUser([], 'user@example.com', now);
    expect(result).toEqual([]);
  });

  it('returns upcoming reservations for the user', () => {
    const res = makeReservation({
      userId: 'user@example.com',
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(1);
    expect(result[0].reservationId).toBe('R1');
  });

  it('excludes canceled reservations', () => {
    const res = makeReservation({
      status: 'canceled',
      canceledAt: new Date('2026-03-15T07:00:00Z'),
    });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(0);
  });

  it('excludes no-show reservations', () => {
    const res = makeReservation({
      status: 'no_show',
      noShowAt: new Date('2026-03-15T07:30:00Z'),
    });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(0);
  });

  it('excludes complete reservations', () => {
    const res = makeReservation({ status: 'complete' });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(0);
  });

  it('excludes reservations that have already ended', () => {
    const res = makeReservation({
      startTime: new Date('2026-03-15T07:00:00Z'),
      endTime: new Date('2026-03-15T08:00:00Z'), // ended before `now`
    });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(0);
  });

  it('excludes reservations for other users', () => {
    const res = makeReservation({ userId: 'other@example.com' });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(0);
  });

  it('is case-insensitive on email', () => {
    const res = makeReservation({ userId: 'User@Example.com' });
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result).toHaveLength(1);
  });

  it('sorts by start time ascending', () => {
    const res1 = makeReservation({
      id: 'R1',
      startTime: new Date('2026-03-15T11:00:00Z'),
      endTime: new Date('2026-03-15T12:00:00Z'),
    });
    const res2 = makeReservation({
      id: 'R2',
      startTime: new Date('2026-03-15T09:00:00Z'),
      endTime: new Date('2026-03-15T10:00:00Z'),
    });
    const result = getUpcomingReservationsForUser([res1, res2], 'user@example.com', now);
    expect(result).toHaveLength(2);
    expect(result[0].reservationId).toBe('R2');
    expect(result[1].reservationId).toBe('R1');
  });

  it('returns serialized reservation objects', () => {
    const res = makeReservation();
    const result = getUpcomingReservationsForUser([res], 'user@example.com', now);
    expect(result[0]).toHaveProperty('reservationId');
    expect(result[0]).toHaveProperty('chargerId');
    expect(result[0]).toHaveProperty('userEmail');
    expect(result[0]).toHaveProperty('startTime');
    expect(typeof result[0].startTime).toBe('string');
  });
});
