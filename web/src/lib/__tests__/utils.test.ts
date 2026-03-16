import { describe, it, expect } from 'vitest';
import {
  isTrue,
  addMinutes,
  toDate,
  startOfDay,
  dayKey,
  monthKey,
  isSameDay,
  addBusinessDays,
  padTime,
  formatTime,
  formatDate,
  formatDateTime,
  formatDuration,
  parseSlotStarts,
  buildSlotsForDay,
  findSlotForTime,
  isSlotStart,
  isComplete,
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  formatSlackChannelLabel,
  deriveFullNameFromEmail,
  formatUserDisplay,
  serializeSuspension,
} from '@/lib/utils';

// ---------------------------------------------------------------------------
// isTrue
// ---------------------------------------------------------------------------
describe('isTrue', () => {
  it('returns true for boolean true', () => {
    expect(isTrue(true)).toBe(true);
  });
  it('returns true for string "TRUE"', () => {
    expect(isTrue('TRUE')).toBe(true);
  });
  it('returns true for string "true"', () => {
    expect(isTrue('true')).toBe(true);
  });
  it('returns true for number 1', () => {
    expect(isTrue(1)).toBe(true);
  });
  it('returns false for false', () => {
    expect(isTrue(false)).toBe(false);
  });
  it('returns false for 0', () => {
    expect(isTrue(0)).toBe(false);
  });
  it('returns false for "yes"', () => {
    expect(isTrue('yes')).toBe(false);
  });
  it('returns false for null/undefined', () => {
    expect(isTrue(null)).toBe(false);
    expect(isTrue(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addMinutes
// ---------------------------------------------------------------------------
describe('addMinutes', () => {
  it('adds minutes to a date', () => {
    const base = new Date('2026-03-15T10:00:00Z');
    const result = addMinutes(base, 30);
    expect(result.getTime()).toBe(base.getTime() + 30 * 60_000);
  });
  it('handles zero minutes', () => {
    const base = new Date('2026-03-15T10:00:00Z');
    expect(addMinutes(base, 0).getTime()).toBe(base.getTime());
  });
  it('handles negative minutes', () => {
    const base = new Date('2026-03-15T10:30:00Z');
    const result = addMinutes(base, -15);
    expect(result.getTime()).toBe(base.getTime() - 15 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// toDate
// ---------------------------------------------------------------------------
describe('toDate', () => {
  it('returns null for falsy values', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate(0)).toBeNull();
  });
  it('passes through Date objects', () => {
    const d = new Date('2026-01-01');
    expect(toDate(d)).toBe(d);
  });
  it('parses ISO strings', () => {
    const result = toDate('2026-03-15T10:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe('2026-03-15T10:00:00.000Z');
  });
  it('returns null for invalid strings', () => {
    expect(toDate('not-a-date')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startOfDay / dayKey / monthKey / isSameDay
// ---------------------------------------------------------------------------
describe('startOfDay', () => {
  it('returns midnight for the given date', () => {
    const d = new Date(2026, 2, 15, 14, 30, 0);
    const sod = startOfDay(d);
    expect(sod.getHours()).toBe(0);
    expect(sod.getMinutes()).toBe(0);
    expect(sod.getDate()).toBe(15);
  });
});

describe('dayKey', () => {
  it('formats as yyyy-MM-dd', () => {
    const d = new Date(2026, 0, 5, 12, 0, 0); // Jan 5
    expect(dayKey(d)).toBe('2026-01-05');
  });
});

describe('monthKey', () => {
  it('formats as yyyy-MM', () => {
    const d = new Date(2026, 11, 25);
    expect(monthKey(d)).toBe('2026-12');
  });
});

describe('isSameDay', () => {
  it('returns true for same calendar day', () => {
    const a = new Date(2026, 2, 15, 8, 0);
    const b = new Date(2026, 2, 15, 22, 0);
    expect(isSameDay(a, b)).toBe(true);
  });
  it('returns false for different days', () => {
    const a = new Date(2026, 2, 15);
    const b = new Date(2026, 2, 16);
    expect(isSameDay(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addBusinessDays
// ---------------------------------------------------------------------------
describe('addBusinessDays', () => {
  it('skips weekends', () => {
    // Friday March 13, 2026
    const friday = new Date(2026, 2, 13);
    const result = addBusinessDays(friday, 2);
    // Should skip Sat+Sun, land on Tuesday March 17
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.getDate()).toBe(17);
  });
  it('returns same date for 0 days', () => {
    const d = new Date(2026, 2, 15);
    const result = addBusinessDays(d, 0);
    expect(result.getTime()).toBe(d.getTime());
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
describe('padTime', () => {
  it('pads single digit', () => {
    expect(padTime(5)).toBe('05');
  });
  it('does not pad double digit', () => {
    expect(padTime(12)).toBe('12');
  });
});

describe('formatTime', () => {
  it('formats AM time', () => {
    const d = new Date(2026, 2, 15, 9, 5, 0);
    expect(formatTime(d)).toBe('9:05 AM');
  });
  it('formats PM time', () => {
    const d = new Date(2026, 2, 15, 14, 30, 0);
    expect(formatTime(d)).toBe('2:30 PM');
  });
  it('formats 12 noon as 12 PM', () => {
    const d = new Date(2026, 2, 15, 12, 0, 0);
    expect(formatTime(d)).toBe('12:00 PM');
  });
  it('formats midnight as 12 AM', () => {
    const d = new Date(2026, 2, 15, 0, 0, 0);
    expect(formatTime(d)).toBe('12:00 AM');
  });
});

describe('formatDate', () => {
  it('formats as "MMM d, yyyy"', () => {
    const d = new Date(2026, 2, 15);
    expect(formatDate(d)).toBe('Mar 15, 2026');
  });
});

describe('formatDateTime', () => {
  it('combines date and time', () => {
    const d = new Date(2026, 2, 15, 14, 30, 0);
    expect(formatDateTime(d)).toBe('Mar 15, 2026 2:30 PM');
  });
});

describe('formatDuration', () => {
  it('formats 1 minute', () => {
    expect(formatDuration(1)).toBe('1 minute');
  });
  it('formats minutes under 60', () => {
    expect(formatDuration(45)).toBe('45 minutes');
  });
  it('formats exact hours', () => {
    expect(formatDuration(120)).toBe('2 hours');
  });
  it('formats hours and minutes', () => {
    expect(formatDuration(90)).toBe('1 hour 30 minutes');
  });
  it('formats 61 minutes', () => {
    expect(formatDuration(61)).toBe('1 hour 1 minute');
  });
  it('clamps negative to 0', () => {
    expect(formatDuration(-5)).toBe('0 minutes');
  });
});

// ---------------------------------------------------------------------------
// Slot parsing
// ---------------------------------------------------------------------------
describe('parseSlotStarts', () => {
  it('parses comma-separated times', () => {
    expect(parseSlotStarts('8:00,10:30,14:00')).toEqual([480, 630, 840]);
  });
  it('parses semicolon-separated times', () => {
    expect(parseSlotStarts('8:00;10:30')).toEqual([480, 630]);
  });
  it('handles empty/null input', () => {
    expect(parseSlotStarts('')).toEqual([]);
    expect(parseSlotStarts(null)).toEqual([]);
  });
  it('deduplicates and sorts', () => {
    expect(parseSlotStarts('10:30,8:00,10:30')).toEqual([480, 630]);
  });
  it('filters invalid entries', () => {
    expect(parseSlotStarts('8:00,25:00,bad')).toEqual([480]);
  });
});

describe('buildSlotsForDay', () => {
  it('builds slot windows', () => {
    const day = new Date(2026, 2, 15);
    const slots = buildSlotsForDay('8:00,10:00', 60, day);
    expect(slots).toHaveLength(2);
    expect(slots[0].startTime.getHours()).toBe(8);
    expect(slots[0].endTime.getHours()).toBe(9);
    expect(slots[1].startTime.getHours()).toBe(10);
    expect(slots[1].endTime.getHours()).toBe(11);
  });
  it('returns empty for 0 maxMinutes', () => {
    expect(buildSlotsForDay('8:00', 0, new Date())).toEqual([]);
  });
});

describe('findSlotForTime', () => {
  it('finds the containing slot', () => {
    const time = new Date(2026, 2, 15, 8, 30, 0);
    const slot = findSlotForTime('8:00,10:00', 60, time);
    expect(slot).not.toBeNull();
    expect(slot!.startTime.getHours()).toBe(8);
  });
  it('returns null when outside all slots', () => {
    const time = new Date(2026, 2, 15, 9, 30, 0);
    const slot = findSlotForTime('8:00,10:00', 60, time);
    expect(slot).toBeNull();
  });
});

describe('isSlotStart', () => {
  it('returns true for valid slot start', () => {
    const t = new Date(2026, 2, 15, 8, 0, 0);
    expect(isSlotStart('8:00,10:00', t)).toBe(true);
  });
  it('returns false for non-slot time', () => {
    const t = new Date(2026, 2, 15, 9, 0, 0);
    expect(isSlotStart('8:00,10:00', t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Status checkers
// ---------------------------------------------------------------------------
describe('isComplete', () => {
  it('returns true when complete is true', () => {
    expect(isComplete({ complete: true, status: 'active' })).toBe(true);
  });
  it('returns true when status is "complete"', () => {
    expect(isComplete({ complete: false, status: 'complete' })).toBe(true);
  });
  it('returns false for active session', () => {
    expect(isComplete({ complete: false, status: 'active' })).toBe(false);
  });
});

describe('isReservationCanceled', () => {
  it('detects by status', () => {
    expect(isReservationCanceled({ status: 'canceled', canceledAt: null })).toBe(true);
  });
  it('detects by canceledAt', () => {
    expect(isReservationCanceled({ status: 'active', canceledAt: new Date() })).toBe(true);
  });
  it('returns false for active reservation', () => {
    expect(isReservationCanceled({ status: 'active', canceledAt: null })).toBe(false);
  });
});

describe('isReservationNoShow', () => {
  it('detects by status', () => {
    expect(isReservationNoShow({ status: 'no_show', noShowAt: null })).toBe(true);
  });
  it('detects by noShowAt', () => {
    expect(isReservationNoShow({ status: 'active', noShowAt: new Date() })).toBe(true);
  });
});

describe('isReservationComplete', () => {
  it('detects by status', () => {
    expect(isReservationComplete({ status: 'complete' })).toBe(true);
  });
  it('returns false for active', () => {
    expect(isReservationComplete({ status: 'active' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
describe('formatSlackChannelLabel', () => {
  it('prepends # to channel name', () => {
    expect(formatSlackChannelLabel('ev-charging')).toBe('#ev-charging');
  });
  it('does not double #', () => {
    expect(formatSlackChannelLabel('#ev-charging')).toBe('#ev-charging');
  });
  it('returns empty for empty input', () => {
    expect(formatSlackChannelLabel('')).toBe('');
    expect(formatSlackChannelLabel(null)).toBe('');
  });
});

describe('deriveFullNameFromEmail', () => {
  it('derives name from dot-separated email', () => {
    expect(deriveFullNameFromEmail('john.doe@example.com')).toBe('John Doe');
  });
  it('derives name from dash-separated email', () => {
    expect(deriveFullNameFromEmail('jane-smith@example.com')).toBe('Jane Smith');
  });
  it('returns empty for single-part local', () => {
    expect(deriveFullNameFromEmail('admin@example.com')).toBe('');
  });
  it('returns empty for empty input', () => {
    expect(deriveFullNameFromEmail('')).toBe('');
  });
});

describe('formatUserDisplay', () => {
  it('uses full name when multi-word', () => {
    expect(formatUserDisplay('John Doe', 'john.doe@example.com')).toBe('John Doe');
  });
  it('falls back to derived name for single-word name', () => {
    expect(formatUserDisplay('John', 'john.doe@example.com')).toBe('John Doe');
  });
  it('falls back to email when no name derivable', () => {
    expect(formatUserDisplay('', 'admin@example.com')).toBe('admin@example.com');
  });
  it('returns "A driver" when nothing available', () => {
    expect(formatUserDisplay('', '')).toBe('A driver');
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
describe('serializeSuspension', () => {
  it('serializes a suspension row', () => {
    const suspension = {
      id: 'abc',
      userId: 'user@example.com',
      userName: 'User',
      startAt: new Date('2026-03-15T00:00:00Z'),
      endAt: new Date('2026-03-17T00:00:00Z'),
      reason: 'Two-strike rule',
      active: true,
      createdAt: new Date('2026-03-15T00:00:00Z'),
    };
    const result = serializeSuspension(suspension);
    expect(result.startAt).toBe('2026-03-15T00:00:00.000Z');
    expect(result.endAt).toBe('2026-03-17T00:00:00.000Z');
    expect(result.reason).toBe('Two-strike rule');
  });
});
