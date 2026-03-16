'use client';

import { useMemo } from 'react';
import type { BoardData, ChargerView, SerializedReservation } from '@/types';
import { SessionTimer } from './session-timer';

interface StatusBannerProps {
  boardData: BoardData;
  onEndSession: (sessionId: string) => void;
  isLoading: boolean;
}

/** Format a time string to locale time (e.g. "2:30 PM"). */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Top-of-grid banner showing the user's current status:
 * - Active session with End Session button
 * - Suspension warning
 * - Upcoming reservation info
 * Renders nothing when there is no relevant status.
 */
export function StatusBanner({ boardData, onEndSession, isLoading }: StatusBannerProps) {
  const { user, chargers, reservations } = boardData;

  // Suspension banner
  if (user.suspension) {
    const endAt = user.suspension.endAt ? new Date(user.suspension.endAt) : null;
    let endLabel = 'soon';
    if (endAt && !isNaN(endAt.getTime())) {
      endLabel =
        endAt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
        ' at ' +
        endAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    return (
      <div className="p-3 px-4 rounded-[var(--radius-md)] bg-[var(--color-danger-soft)] border border-[#fecaca] text-[var(--color-danger)] text-[13px] mb-4 animate-fade-up">
        <strong className="block text-sm mb-1">Charging privileges suspended</strong>
        You cannot start sessions or make reservations until {endLabel}. Please contact Facilities
        if you have questions.
      </div>
    );
  }

  // Find user's active session
  const mySession = useMemo(() => {
    const email = (user.email || '').toLowerCase();
    for (const charger of chargers) {
      if (
        charger.session &&
        charger.session.userEmail.toLowerCase() === email &&
        charger.session.status !== 'complete'
      ) {
        return { charger, session: charger.session };
      }
    }
    return null;
  }, [chargers, user.email]);

  if (mySession) {
    const { charger, session } = mySession;
    const endTime = new Date(session.endTime);
    const diffMs = endTime.getTime() - Date.now();
    const diffMin = Math.ceil(diffMs / 60_000);

    let subText = 'When finished, unplug your car and tap "End Session" below.';
    let subClass = '';
    if (diffMs <= 0) {
      subText = 'Time is up! Please unplug and end your session.';
      subClass = 'text-[var(--color-danger)] font-bold';
    } else if (diffMin <= 10) {
      subText = `${diffMin} min left \u2014 when done, unplug and tap "End Session" below.`;
      subClass = 'text-[var(--color-primary)] font-semibold';
    }

    return (
      <div className="bg-[var(--color-surface)] border-[1.5px] border-[var(--color-primary)] rounded-[var(--radius-lg)] p-3 px-4 mb-4 flex flex-col gap-2 animate-fade-up">
        <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[var(--color-primary)]">
          Your session
        </span>
        <span className="text-[15px] font-semibold text-[var(--color-text)]">
          {charger.name} &middot; ends at {fmtTime(session.endTime)}
        </span>
        <span className={`text-[13px] text-[var(--color-muted)] ${subClass}`}>{subText}</span>
        <SessionTimer endTime={session.endTime} className="text-lg" />
        <button
          className="mt-1 w-full min-h-[var(--spacing-tap)] rounded-full bg-[var(--color-primary)] text-white text-[15px] font-bold tracking-[0.01em] shadow-[0_10px_22px_rgba(240,90,42,0.25)] transition-all duration-150 active:scale-[0.97] disabled:opacity-60"
          onClick={() => onEndSession(session.sessionId)}
          disabled={isLoading}
        >
          {isLoading ? 'Ending...' : 'End Session'}
        </button>
      </div>
    );
  }

  // Find upcoming reservation (not checked in, not canceled/no-show)
  const upcomingReservation = useMemo(() => {
    return (reservations || []).find(
      (r: SerializedReservation) =>
        !r.checkedInAt && r.status !== 'no_show' && r.status !== 'canceled',
    );
  }, [reservations]);

  if (upcomingReservation) {
    const charger = chargers.find((c: ChargerView) => String(c.id) === String(upcomingReservation.chargerId));
    const chargerName = charger ? charger.name : `Charger ${upcomingReservation.chargerId}`;

    return (
      <div className="bg-[var(--color-surface)] border-[1.5px] border-[var(--color-primary)] rounded-[var(--radius-lg)] p-3 px-4 mb-4 flex flex-col gap-2 animate-fade-up">
        <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[var(--color-primary)]">
          Upcoming reservation
        </span>
        <span className="text-[15px] font-semibold text-[var(--color-text)]">
          {chargerName} &middot; starts at {fmtTime(upcomingReservation.startTime)}
        </span>
        <span className="text-[13px] text-[var(--color-muted)]">
          1. Drive to charger &rarr; 2. Plug in &rarr; 3. Tap Check In when the window opens
        </span>
      </div>
    );
  }

  // Nothing active — render nothing
  return null;
}
