import type { Session, Reservation, Suspension } from '@/types';
import type { SerializedSuspension, SerializedSession, SerializedReservation, Slot } from '@/types';

// ---------------------------------------------------------------------------
// Boolean coercion
// ---------------------------------------------------------------------------

/** Coerce truthy sheet values (true, "TRUE", "true", 1) to boolean. */
export function isTrue(val: unknown): boolean {
  return val === true || val === 'TRUE' || val === 'true' || val === 1;
}

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

/** The business timezone — all calendar-day logic uses this, not the server timezone. */
export const APP_TIMEZONE = 'America/Los_Angeles';

/**
 * Extract date/time parts of `date` as they appear in Pacific Time.
 * Uses Intl.DateTimeFormat so DST is handled automatically.
 */
function pacificParts(date: Date): {
  year: number;
  month: number; // 0-indexed
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  weekday: string; // 'Sun', 'Mon', …
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10) - 1, // 0-indexed
    day: parseInt(parts.day, 10),
    hours: parseInt(parts.hour, 10) % 24, // hour12:false can produce '24' for midnight
    minutes: parseInt(parts.minute, 10),
    seconds: parseInt(parts.second, 10),
    weekday: parts.weekday,
  };
}

/** Return a new Date `minutes` ahead of `date`. */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Safely coerce a value to a Date, returning null on failure. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value as string | number);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Return the UTC timestamp that represents midnight Pacific Time on the
 * same calendar day as `date` in Pacific Time.
 */
export function startOfDay(date: Date): Date {
  const { year, month, day } = pacificParts(date);
  // Find the Pacific UTC offset for this date by checking where noon UTC lands in Pacific.
  // Noon UTC is always within the same Pacific calendar day, so the offset is stable.
  const noonUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const { hours: pacificNoonHour } = pacificParts(noonUtc);
  // PST (UTC-8): noon UTC = 4 AM Pacific → offset = 8h
  // PDT (UTC-7): noon UTC = 5 AM Pacific → offset = 7h
  const pacificOffsetHours = 12 - pacificNoonHour;
  return new Date(Date.UTC(year, month, day, pacificOffsetHours, 0, 0));
}

/** "yyyy-MM-dd" key for grouping by day (Pacific Time). */
export function dayKey(date: Date): string {
  const { year, month, day } = pacificParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "yyyy-MM" key for monthly grouping (Pacific Time). */
export function monthKey(date: Date): string {
  const { year, month } = pacificParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Check whether two dates fall on the same calendar day (Pacific Time). */
export function isSameDay(first: Date, second: Date): boolean {
  return dayKey(first) === dayKey(second);
}

/** Add business days (skip weekends, using Pacific Time for day-of-week). */
export function addBusinessDays(date: Date, days: number): Date {
  let result = new Date(date.getTime());
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    result = new Date(result.getTime() + 86_400_000);
    const { weekday } = pacificParts(result);
    if (weekday !== 'Sun' && weekday !== 'Sat') {
      remaining -= 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/** Zero-pad a number to two digits. */
export function padTime(val: number): string {
  return String(val).padStart(2, '0');
}

/** Format a Date as "h:mm AM/PM" in Pacific Time. */
export function formatTime(date: Date): string {
  const { hours, minutes } = pacificParts(date);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return `${h}:${padTime(minutes)} ${ampm}`;
}

/** Format a Date as "MMM d, yyyy" (e.g. "Mar 15, 2026") in Pacific Time. */
export function formatDate(date: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const { year, month, day } = pacificParts(date);
  return `${months[month]} ${day}, ${year}`;
}

/** Format a Date as "MMM d, yyyy h:mm AM/PM". */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** Format a duration in minutes as a human-friendly string. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 1) return '1 minute';
  if (total < 60) return `${total} minutes`;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  if (!remainder) return hourLabel;
  const minuteLabel = remainder === 1 ? '1 minute' : `${remainder} minutes`;
  return `${hourLabel} ${minuteLabel}`;
}

// ---------------------------------------------------------------------------
// Slot parsing
// ---------------------------------------------------------------------------

/**
 * Parse a comma/semicolon/newline-separated string of "HH:MM" times
 * into sorted, deduplicated minute-of-day values.
 */
export function parseSlotStarts(value: unknown): number[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const starts = raw
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split(':');
      if (parts.length < 2) return null;
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
      }
      return hours * 60 + minutes;
    })
    .filter((v): v is number => v !== null);

  starts.sort((a, b) => a - b);
  // deduplicate
  return starts.filter((v, i) => starts.indexOf(v) === i);
}

/**
 * Build slot windows for a charger on a given day.
 */
export function buildSlotsForDay(
  slotStarts: string,
  maxMinutes: number,
  day: Date,
): Slot[] {
  if (maxMinutes <= 0) return [];
  const parsed = parseSlotStarts(slotStarts);
  if (!parsed.length) return [];
  const base = startOfDay(day);
  return parsed.map((mins) => {
    const start = addMinutes(base, mins);
    return { startTime: start, endTime: addMinutes(start, maxMinutes) };
  });
}

/**
 * Find the slot that contains `time` for a charger.
 */
export function findSlotForTime(
  slotStarts: string,
  maxMinutes: number,
  time: Date,
): Slot | null {
  const slots = buildSlotsForDay(slotStarts, maxMinutes, startOfDay(time));
  for (const slot of slots) {
    if (time.getTime() >= slot.startTime.getTime() && time.getTime() < slot.endTime.getTime()) {
      return slot;
    }
  }
  return null;
}

/**
 * Check if a given time is a valid slot start for a charger (Pacific Time).
 */
export function isSlotStart(slotStartsStr: string, startTime: Date): boolean {
  const parsed = parseSlotStarts(slotStartsStr);
  const { hours, minutes } = pacificParts(startTime);
  return parsed.includes(hours * 60 + minutes);
}

// ---------------------------------------------------------------------------
// Status checkers
// ---------------------------------------------------------------------------

/** Is the session complete? */
export function isComplete(session: Pick<Session, 'complete' | 'status'>): boolean {
  return isTrue(session.complete) || String(session.status).toLowerCase() === 'complete';
}

/** Is the reservation canceled? */
export function isReservationCanceled(reservation: Pick<Reservation, 'status' | 'canceledAt'>): boolean {
  return String(reservation.status || '').toLowerCase() === 'canceled' || !!reservation.canceledAt;
}

/** Is the reservation a no-show? */
export function isReservationNoShow(reservation: Pick<Reservation, 'status' | 'noShowAt'>): boolean {
  return String(reservation.status || '').toLowerCase() === 'no_show' || !!reservation.noShowAt;
}

/** Is the reservation complete? */
export function isReservationComplete(reservation: Pick<Reservation, 'status'>): boolean {
  return String(reservation.status || '').toLowerCase() === 'complete';
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format a Slack channel name with leading #. */
export function formatSlackChannelLabel(name: string | null | undefined): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const clean = raw.charAt(0) === '#' ? raw.slice(1) : raw;
  return `#${clean}`;
}

/** Derive a full name from an email address (e.g. "john.doe@..." -> "John Doe"). */
export function deriveFullNameFromEmail(email: string | null | undefined): string {
  if (!email) return '';
  const local = String(email).split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2) return '';
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/** Format a user for display — prefers derived full name over single-word names. */
export function formatUserDisplay(name: string | null | undefined, email: string | null | undefined): string {
  const safeName = String(name || '').trim();
  const safeEmail = String(email || '').trim();
  const derivedName = deriveFullNameFromEmail(safeEmail);
  let displayName = safeName;
  if (displayName && displayName.split(/\s+/).length < 2 && derivedName) {
    displayName = derivedName;
  }
  if (!displayName) displayName = derivedName;
  if (!displayName) return safeEmail || 'A driver';
  return displayName;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function toIso(value: unknown): string {
  const date = toDate(value);
  return date ? date.toISOString() : '';
}

export function serializeSession(session: Session): SerializedSession {
  return {
    sessionId: session.id,
    chargerId: session.chargerId,
    userEmail: session.userId,
    userName: session.userName,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime.toISOString(),
    status: session.status,
    overdue: isTrue(session.overdue),
  };
}

export function serializeReservation(reservation: Reservation): SerializedReservation {
  return {
    reservationId: reservation.id,
    chargerId: reservation.chargerId,
    userEmail: reservation.userId,
    userName: reservation.userName,
    startTime: reservation.startTime.toISOString(),
    endTime: reservation.endTime.toISOString(),
    status: reservation.status,
    checkedInAt: toIso(reservation.checkedInAt),
    noShowAt: toIso(reservation.noShowAt),
  };
}

export function serializeSuspension(suspension: Suspension): SerializedSuspension {
  return {
    startAt: suspension.startAt.toISOString(),
    endAt: suspension.endAt.toISOString(),
    reason: suspension.reason,
  };
}
