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
// All tests use UTC ISO strings (TZ=UTC in vitest env) so inputs are
// deterministic regardless of developer machine timezone.
// January dates = PST (UTC-8). June dates = PDT (UTC-7).
// DST in 2026 starts March 8, ends November 1.

describe('startOfDay', () => {
  it('returns Pacific midnight (PST) for a mid-day UTC date in January', () => {
    // 2026-01-15 12:00 UTC = 4:00 AM PST — still Jan 15 in Pacific
    const sod = startOfDay(new Date('2026-01-15T12:00:00Z'));
    // Midnight PST = 08:00 UTC
    expect(sod.toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });
  it('returns previous Pacific date when UTC has crossed midnight but Pacific has not (PST)', () => {
    // 2026-01-15T07:30:00Z = 11:30 PM PST on Jan 14
    const sod = startOfDay(new Date('2026-01-15T07:30:00Z'));
    expect(sod.toISOString()).toBe('2026-01-14T08:00:00.000Z');
  });
  it('handles PDT (UTC-7) in June', () => {
    // 2026-06-15 12:00 UTC = 5:00 AM PDT — June 15 in Pacific
    const sod = startOfDay(new Date('2026-06-15T12:00:00Z'));
    // Midnight PDT = 07:00 UTC
    expect(sod.toISOString()).toBe('2026-06-15T07:00:00.000Z');
  });

  // --- Regression: DST spring-forward edge case ---
  // On March 8, 2026 (spring-forward) clocks jump 2:00 AM PST → 3:00 AM PDT.
  // Pacific midnight starts in PST (08:00 UTC). The previous implementation used
  // noon UTC to infer the offset — noon is already in PDT, so it returned 07:00 UTC
  // (11 PM PST the prior night). The fixed version tries PST offset first.
  it('returns PST midnight (08:00 UTC) on the spring-forward day, not PDT midnight', () => {
    const afternoonSpringForward = new Date('2026-03-08T20:00:00Z'); // 1:00 PM PDT
    expect(startOfDay(afternoonSpringForward).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('returns PDT midnight (07:00 UTC) on a normal PDT day (April)', () => {
    const afternoonPDT = new Date('2026-04-29T20:00:00Z'); // 1:00 PM PDT
    expect(startOfDay(afternoonPDT).toISOString()).toBe('2026-04-29T07:00:00.000Z');
  });

  it('returns PDT midnight (07:00 UTC) on the fall-back day — midnight starts in PDT', () => {
    // November 1, 2026: clocks fall back at 2:00 AM PDT → 1:00 AM PST.
    // Midnight still starts in PDT → midnight PDT = 07:00 UTC.
    const afternoonFallBack = new Date('2026-11-01T21:00:00Z'); // 1:00 PM PST (after fall-back)
    expect(startOfDay(afternoonFallBack).toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });
});

describe('dayKey', () => {
  it('formats as yyyy-MM-dd in Pacific Time (PST)', () => {
    // 2026-01-05 20:00 UTC = noon PST → Jan 5 Pacific
    expect(dayKey(new Date('2026-01-05T20:00:00Z'))).toBe('2026-01-05');
  });
  it('returns previous Pacific date when UTC crossed midnight but Pacific has not', () => {
    // 2026-01-15T07:59:00Z = 11:59 PM PST on Jan 14
    expect(dayKey(new Date('2026-01-15T07:59:00Z'))).toBe('2026-01-14');
  });
  it('returns current Pacific date at Pacific midnight', () => {
    // 2026-01-15T08:00:00Z = midnight PST Jan 15
    expect(dayKey(new Date('2026-01-15T08:00:00Z'))).toBe('2026-01-15');
  });
});

describe('monthKey', () => {
  it('formats as yyyy-MM in Pacific Time', () => {
    expect(monthKey(new Date('2026-12-25T12:00:00Z'))).toBe('2026-12');
  });
  it('returns previous month when UTC is Jan 1 but Pacific is still Dec 31', () => {
    // 2026-01-01T06:00:00Z = 10:00 PM PST on Dec 31, 2025
    expect(monthKey(new Date('2026-01-01T06:00:00Z'))).toBe('2025-12');
  });
});

describe('isSameDay', () => {
  it('returns true for same Pacific calendar day', () => {
    const a = new Date('2026-01-15T09:00:00Z'); // 1 AM PST Jan 15
    const b = new Date('2026-01-16T05:00:00Z'); // 9 PM PST Jan 15
    expect(isSameDay(a, b)).toBe(true);
  });
  it('returns false for different Pacific days', () => {
    const a = new Date('2026-01-15T08:00:00Z'); // midnight PST Jan 15
    const b = new Date('2026-01-16T08:00:00Z'); // midnight PST Jan 16
    expect(isSameDay(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addBusinessDays
// ---------------------------------------------------------------------------
describe('addBusinessDays', () => {
  it('skips weekends using Pacific calendar day', () => {
    // Friday Jan 2, 2026 at noon PST = 20:00 UTC
    const friday = new Date('2026-01-02T20:00:00Z');
    const result = addBusinessDays(friday, 2);
    // Should skip Sat Jan 3 + Sun Jan 4, land on Tuesday Jan 6 Pacific
    expect(dayKey(result)).toBe('2026-01-06');
  });
  it('returns same timestamp for 0 days', () => {
    const d = new Date('2026-01-15T12:00:00Z');
    expect(addBusinessDays(d, 0).getTime()).toBe(d.getTime());
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

// January 2026 = PST (UTC-8): noon PST = 20:00 UTC, midnight PST = 08:00 UTC
describe('formatTime', () => {
  it('formats AM time in Pacific (PST)', () => {
    // 2026-01-15T17:05:00Z = 9:05 AM PST
    expect(formatTime(new Date('2026-01-15T17:05:00Z'))).toBe('9:05 AM');
  });
  it('formats PM time in Pacific (PST)', () => {
    // 2026-01-15T22:30:00Z = 2:30 PM PST
    expect(formatTime(new Date('2026-01-15T22:30:00Z'))).toBe('2:30 PM');
  });
  it('formats noon PST as 12:00 PM', () => {
    // 2026-01-15T20:00:00Z = noon PST
    expect(formatTime(new Date('2026-01-15T20:00:00Z'))).toBe('12:00 PM');
  });
  it('formats Pacific midnight as 12:00 AM', () => {
    // 2026-01-15T08:00:00Z = midnight PST
    expect(formatTime(new Date('2026-01-15T08:00:00Z'))).toBe('12:00 AM');
  });
});

describe('formatDate', () => {
  it('formats as "MMM d, yyyy" in Pacific Time (PST)', () => {
    // 2026-01-15T12:00:00Z = 4 AM PST — still Jan 15 Pacific
    expect(formatDate(new Date('2026-01-15T12:00:00Z'))).toBe('Jan 15, 2026');
  });
  it('uses Pacific date even when UTC date differs', () => {
    // 2026-01-15T07:30:00Z = 11:30 PM PST on Jan 14
    expect(formatDate(new Date('2026-01-15T07:30:00Z'))).toBe('Jan 14, 2026');
  });
});

describe('formatDateTime', () => {
  it('combines date and time in Pacific (PST)', () => {
    // 2026-01-15T22:30:00Z = Jan 15, 2:30 PM PST
    expect(formatDateTime(new Date('2026-01-15T22:30:00Z'))).toBe('Jan 15, 2026 2:30 PM');
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

// January 2026 = PST (UTC-8): 8:00 AM PST = 16:00 UTC, 10:00 AM PST = 18:00 UTC
describe('buildSlotsForDay', () => {
  it('builds slot windows anchored to Pacific midnight (PST)', () => {
    // 2026-01-15T12:00:00Z = 4 AM PST Jan 15
    const day = new Date('2026-01-15T12:00:00Z');
    const slots = buildSlotsForDay('8:00,10:00', 60, day);
    expect(slots).toHaveLength(2);
    // 8:00 AM PST = 16:00 UTC; end at 9:00 AM PST = 17:00 UTC
    expect(slots[0].startTime.toISOString()).toBe('2026-01-15T16:00:00.000Z');
    expect(slots[0].endTime.toISOString()).toBe('2026-01-15T17:00:00.000Z');
    // 10:00 AM PST = 18:00 UTC; end at 11:00 AM PST = 19:00 UTC
    expect(slots[1].startTime.toISOString()).toBe('2026-01-15T18:00:00.000Z');
    expect(slots[1].endTime.toISOString()).toBe('2026-01-15T19:00:00.000Z');
  });
  it('returns empty for 0 maxMinutes', () => {
    expect(buildSlotsForDay('8:00', 0, new Date())).toEqual([]);
  });
});

describe('findSlotForTime', () => {
  it('finds the containing slot', () => {
    // 8:30 AM PST = 16:30 UTC — should fall in 8:00–9:00 slot
    const time = new Date('2026-01-15T16:30:00Z');
    const slot = findSlotForTime('8:00,10:00', 60, time);
    expect(slot).not.toBeNull();
    expect(slot!.startTime.toISOString()).toBe('2026-01-15T16:00:00.000Z');
  });
  it('returns null when outside all slots', () => {
    // 9:30 AM PST = 17:30 UTC — between the 8:00 and 10:00 slots
    const time = new Date('2026-01-15T17:30:00Z');
    const slot = findSlotForTime('8:00,10:00', 60, time);
    expect(slot).toBeNull();
  });
});

describe('isSlotStart', () => {
  it('returns true for valid slot start in Pacific Time', () => {
    // 8:00 AM PST = 16:00 UTC
    expect(isSlotStart('8:00,10:00', new Date('2026-01-15T16:00:00Z'))).toBe(true);
  });
  it('returns false for non-slot time', () => {
    // 9:00 AM PST = 17:00 UTC — not in '8:00,10:00' list
    expect(isSlotStart('8:00,10:00', new Date('2026-01-15T17:00:00Z'))).toBe(false);
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
