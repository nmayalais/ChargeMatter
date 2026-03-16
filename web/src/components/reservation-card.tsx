'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SerializedReservation, ChargerView } from '@/types';

interface ReservationCardProps {
  reservation: SerializedReservation;
  chargers: ChargerView[];
  serverTime: string;
  config: Record<string, unknown>;
  onCheckIn: (reservationId: string) => Promise<void>;
  onCancel: (reservationId: string) => Promise<void>;
  onModify: (reservationId: string) => void;
  onComplete: (reservationId: string) => Promise<void>;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getCountdownText(targetIso: string, serverTime: string): string {
  const target = new Date(targetIso).getTime();
  const now = new Date(serverTime).getTime() + (Date.now() - new Date(serverTime).getTime());
  const diff = target - now;
  if (diff <= 0) return '';
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `in ${h}h ${m}m`;
  }
  if (mins > 0) return `in ${mins}m ${secs}s`;
  return `in ${secs}s`;
}

/**
 * Displays a user's existing reservation with status and action buttons.
 */
export function ReservationCard({
  reservation,
  chargers,
  serverTime,
  config,
  onCheckIn,
  onCancel,
  onModify,
  onComplete,
}: ReservationCardProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');

  const isCheckedIn = !!reservation.checkedInAt;
  const isActive = reservation.status === 'active';

  // Check-in window computation
  const checkinEarlyMinutes = Number(config.reservationCheckinEarlyMinutes) || 0;
  const earlyStartMinutes = Number(config.reservationEarlyStartMinutes) || 15;
  const earlyMinutes = Math.max(checkinEarlyMinutes, earlyStartMinutes);
  const lateGraceMinutes = Number(config.reservationLateGraceMinutes) || 30;

  const startMs = new Date(reservation.startTime).getTime();
  const checkInOpens = startMs - earlyMinutes * 60000;
  const checkInCloses = startMs + lateGraceMinutes * 60000;

  const isInCheckInWindow = useCallback(() => {
    const now =
      new Date(serverTime).getTime() +
      (Date.now() - new Date(serverTime).getTime());
    return now >= checkInOpens && now <= checkInCloses;
  }, [serverTime, checkInOpens, checkInCloses]);

  const canCheckIn = isActive && !isCheckedIn && isInCheckInWindow();

  // Countdown ticker
  useEffect(() => {
    function tick() {
      if (isCheckedIn) {
        setCountdown(getCountdownText(reservation.endTime, serverTime));
      } else if (canCheckIn) {
        setCountdown('Check-in open');
      } else if (isActive) {
        setCountdown(getCountdownText(reservation.startTime, serverTime));
      } else {
        setCountdown('');
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [reservation, serverTime, isCheckedIn, canCheckIn, isActive]);

  const charger = chargers.find((c) => c.id === reservation.chargerId);
  const chargerName = charger?.name || `Charger ${reservation.chargerId}`;

  const handleAction = async (
    action: string,
    fn: (id: string) => Promise<void>,
  ) => {
    setLoadingAction(action);
    try {
      await fn(reservation.reservationId);
    } finally {
      setLoadingAction(null);
    }
  };

  // Status badge
  const statusLabel = isCheckedIn ? 'Checked in' : 'Upcoming';
  const statusColors = isCheckedIn
    ? 'bg-[var(--color-status-in-use-bg)] text-[var(--color-status-in-use-text)] border-[var(--color-status-in-use-border)]'
    : 'bg-[var(--color-status-reserved-bg)] text-[var(--color-status-reserved-text)] border-[var(--color-status-reserved-border)]';

  return (
    <div className="bg-[var(--color-surface)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5 grid gap-2.5 animate-fade-up">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-sm">{chargerName}</div>
        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusColors}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Time info */}
      <div className="text-sm text-[var(--color-muted)]">
        <span>
          {formatTime(reservation.startTime)} &ndash;{' '}
          {formatTime(reservation.endTime)}
        </span>
        <span className="mx-1.5 opacity-40">&middot;</span>
        <span>
          {formatDuration(reservation.startTime, reservation.endTime)}
        </span>
      </div>

      {/* Countdown */}
      {countdown && (
        <div className="text-xs font-medium text-[var(--color-primary)]">
          {isCheckedIn ? `Ends ${countdown}` : canCheckIn ? countdown : `Starts ${countdown}`}
        </div>
      )}

      {/* Checked-in helper text */}
      {isCheckedIn && (
        <div className="text-xs text-[var(--color-muted)]">
          Checked in &mdash; end session to free the spot for the next driver.
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {isCheckedIn ? (
          <button
            type="button"
            disabled={loadingAction !== null}
            onClick={() => handleAction('complete', onComplete)}
            className="min-h-[var(--spacing-tap)] px-4 rounded-[var(--radius-sm)] text-[13px] font-bold border bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[#fecaca] hover:bg-[#ffdcdc] transition-colors disabled:opacity-50"
          >
            {loadingAction === 'complete' ? 'Ending...' : 'End session'}
          </button>
        ) : (
          <>
            {canCheckIn && (
              <button
                type="button"
                disabled={loadingAction !== null}
                onClick={() => handleAction('checkIn', onCheckIn)}
                className="min-h-[var(--spacing-tap)] px-4 rounded-[var(--radius-sm)] text-[13px] font-bold bg-[var(--color-primary)] text-white border border-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50"
              >
                {loadingAction === 'checkIn' ? 'Checking in...' : 'Check in'}
              </button>
            )}
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={() => onModify(reservation.reservationId)}
              className="min-h-[var(--spacing-tap)] px-4 rounded-[var(--radius-sm)] text-[13px] font-bold bg-transparent text-[var(--color-muted)] border border-[var(--color-border)] hover:border-[var(--color-dark)] transition-colors disabled:opacity-50"
            >
              Change
            </button>
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={() => handleAction('cancel', onCancel)}
              className="min-h-[var(--spacing-tap)] px-4 rounded-[var(--radius-sm)] text-[13px] font-bold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[#fecaca] hover:bg-[#ffdcdc] transition-colors disabled:opacity-50"
            >
              {loadingAction === 'cancel' ? 'Canceling...' : 'Cancel'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
