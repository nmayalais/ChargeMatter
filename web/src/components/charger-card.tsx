'use client';

import { useState, useCallback } from 'react';
import type { ChargerView, BoardData } from '@/types';
import type { ToastType } from './toast';
import { SessionTimer } from './session-timer';
import { Spinner } from './loading';
import { startSession } from '@/actions/sessions';
import { endSession } from '@/actions/sessions';
import { notifyOwner } from '@/actions/admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

function formatUserDisplay(name: string, email: string): string {
  if (name && name.trim()) return name.trim();
  return email ? email.split('@')[0] : 'Unknown';
}

function sameEmail(a: string, b: string): boolean {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Status style mappings
// ---------------------------------------------------------------------------

const statusBadgeStyles: Record<string, string> = {
  free: 'bg-[var(--color-status-free-bg)] text-[var(--color-status-free-text)] border-[var(--color-status-free-border)]',
  in_use:
    'bg-[var(--color-status-in-use-bg)] text-[var(--color-status-in-use-text)] border-[var(--color-status-in-use-border)]',
  reserved:
    'bg-[var(--color-status-reserved-bg)] text-[var(--color-status-reserved-text)] border-[var(--color-status-reserved-border)]',
  overdue:
    'bg-[var(--color-status-overdue-bg)] text-[var(--color-status-overdue-text)] border-[var(--color-status-overdue-border)]',
};

const statusBorderLeft: Record<string, string> = {
  in_use: 'border-l-4 border-l-[var(--color-status-in-use-border)]',
  reserved: 'border-l-4 border-l-[var(--color-status-reserved-border)]',
  overdue: 'border-l-4 border-l-[var(--color-status-overdue-border)]',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChargerCardProps {
  charger: ChargerView;
  userEmail: string;
  boardData: BoardData;
  onAction: () => Promise<void>;
  addToast: (message: string, type?: ToastType) => void;
  statusChanged?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChargerCard({
  charger,
  userEmail,
  boardData,
  onAction,
  addToast,
  statusChanged,
}: ChargerCardProps) {
  const [loading, setLoading] = useState(false);

  const isMySession =
    charger.session && sameEmail(charger.session.userEmail, userEmail);
  const isMyReservation =
    charger.reservation && sameEmail(charger.reservation.userEmail, userEmail);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleStartSession = useCallback(async () => {
    setLoading(true);
    try {
      await startSession(charger.id, {
        email: userEmail,
        name: boardData.user.name,
        isAdmin: boardData.user.isAdmin,
      });
      addToast("Charging started! You'll be notified when your session is ending.", 'success');
      await onAction();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start session';
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [charger.id, userEmail, boardData.user, onAction, addToast]);

  const handleEndSession = useCallback(async () => {
    if (!charger.session) return;
    setLoading(true);
    try {
      await endSession(charger.session.sessionId, {
        email: userEmail,
        name: boardData.user.name,
        isAdmin: boardData.user.isAdmin,
      });
      addToast('Session ended. The charger is now free for others.', 'success');
      await onAction();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to end session';
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [charger.session, userEmail, boardData.user, onAction, addToast]);

  const handleNotifyOwner = useCallback(async () => {
    setLoading(true);
    try {
      const result = await notifyOwner(charger.id, {
        email: userEmail,
        name: boardData.user.name,
        isAdmin: boardData.user.isAdmin,
      });
      addToast(
        result.success
          ? 'Notification sent! The driver has been asked to wrap up.'
          : 'Unable to send notification. Please contact the owner directly.',
        result.success ? 'success' : 'error',
      );
      await onAction();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to notify owner';
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [charger.id, userEmail, boardData.user, onAction, addToast]);

  // ── Availability text ────────────────────────────────────────────────────

  let availPrimary = 'Available now';
  let availSecondary = '';

  if (charger.session) {
    if (charger.statusKey === 'overdue') {
      availPrimary = `Overdue \u00b7 ended at ${fmtTime(charger.session.endTime)}`;
    } else {
      availPrimary = `In use \u00b7 ends at ${fmtTime(charger.session.endTime)}`;
    }
  } else if (charger.reservation) {
    availPrimary = isMyReservation
      ? `Reserved for you \u00b7 starts at ${fmtTime(charger.reservation.startTime)}`
      : `Reserved \u00b7 starts at ${fmtTime(charger.reservation.startTime)}`;
  } else if (charger.walkup && !charger.walkup.isOpen) {
    availPrimary = `Walk-up opens at ${fmtTime(charger.walkup.openAt)}`;
  }

  if (charger.walkup && charger.walkup.isOpen) {
    availSecondary = `Walk-up ends at ${fmtTime(charger.walkup.endTime)}`;
  } else if (charger.nextReservation) {
    availSecondary = `Next reservation: ${formatUserDisplay(charger.nextReservation.userName, charger.nextReservation.userEmail)} at ${fmtTime(charger.nextReservation.startTime)}`;
  }

  // ── Primary action ───────────────────────────────────────────────────────

  type ActionConfig = {
    label: string;
    loadingLabel: string;
    helpText: string;
    handler: () => void;
    variant: 'primary' | 'secondary' | 'danger';
  };

  let primaryAction: ActionConfig | null = null;

  if (charger.session) {
    if (isMySession) {
      primaryAction = {
        label: 'End Session',
        loadingLabel: 'Ending...',
        helpText: 'Ends your session and frees this charger.',
        handler: handleEndSession,
        variant: 'primary',
      };
    } else {
      primaryAction = {
        label: 'Notify owner',
        loadingLabel: 'Notifying...',
        helpText: 'Sends a friendly reminder to wrap up.',
        handler: handleNotifyOwner,
        variant: 'secondary',
      };
    }
  } else if (charger.statusKey === 'overdue') {
    primaryAction = {
      label: 'Notify owner',
      loadingLabel: 'Notifying...',
      helpText: 'Sends a friendly reminder to wrap up.',
      handler: handleNotifyOwner,
      variant: 'danger',
    };
  } else if (charger.statusKey === 'reserved') {
    // Reserved by someone else — no action on this card
    primaryAction = null;
  } else if (charger.walkup && !charger.walkup.isOpen) {
    // Walk-up not open yet — no action
    primaryAction = null;
  } else {
    // Free / walk-up open → Start charging
    primaryAction = {
      label: 'Start charging',
      loadingLabel: 'Starting...',
      helpText:
        charger.walkup && charger.walkup.isOpen
          ? `Walk-up ends at ${fmtTime(charger.walkup.endTime)}. Reserve for a full slot.`
          : 'Starts a new session and holds this spot for you.',
      handler: handleStartSession,
      variant: 'primary',
    };
  }

  // ── Button styles ────────────────────────────────────────────────────────

  const btnBase =
    'w-full min-h-[var(--spacing-tap)] rounded-full text-[15px] font-bold tracking-[0.01em] transition-all duration-150 active:scale-[0.97] disabled:opacity-60 flex items-center justify-center gap-2';
  const btnVariants: Record<string, string> = {
    primary: `${btnBase} bg-[var(--color-primary)] text-white shadow-[0_10px_22px_rgba(240,90,42,0.25)]`,
    secondary: `${btnBase} bg-[var(--color-dark)] text-white`,
    danger: `${btnBase} bg-[var(--color-status-overdue-bg)] text-[var(--color-status-overdue-text)] border border-[var(--color-status-overdue-border)]`,
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const leftBorder = statusBorderLeft[charger.statusKey] || '';

  return (
    <div
      className={`bg-[var(--color-surface)] rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-soft)] border border-[rgba(27,31,39,0.08)] flex flex-col gap-3 relative overflow-hidden transition-all duration-200 ${leftBorder} ${
        statusChanged ? 'animate-[flash-in_600ms_ease_both]' : ''
      }`}
    >
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex justify-between items-start gap-2">
        <div className="grid gap-[6px]">
          {/* Status badge */}
          <span
            className={`inline-block self-start px-3 py-[6px] rounded-full text-xs font-bold uppercase tracking-[0.04em] border-[1.5px] ${
              statusBadgeStyles[charger.statusKey] || statusBadgeStyles.free
            }`}
          >
            {charger.status}
          </span>
          {/* Title */}
          <span className="text-lg font-bold tracking-[-0.015em]">{charger.name}</span>
        </div>

        {/* Duration badge */}
        <span className="text-xs font-semibold text-[var(--color-muted)] bg-[var(--color-surface-muted)] px-[10px] py-[6px] rounded-full border border-[rgba(27,31,39,0.08)] whitespace-nowrap">
          Max {fmtDuration(charger.maxMinutes)}
        </span>
      </div>

      {/* ── Availability summary ─────────────────────── */}
      <div className="grid gap-[6px] p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[rgba(27,31,39,0.06)]">
        <div className="text-base font-bold text-[var(--color-text)]">{availPrimary}</div>
        {availSecondary && (
          <div className="text-[13px] text-[var(--color-muted)]">{availSecondary}</div>
        )}
        {/* Walk-up countdown */}
        {charger.walkup && charger.walkup.isOpen && (
          <div className="flex items-center justify-between text-[13px] text-[var(--color-muted)] border-t border-dashed border-[rgba(27,31,39,0.12)] pt-2">
            <span className="uppercase tracking-[0.08em] text-[11px]">Time left</span>
            <SessionTimer endTime={charger.walkup.endTime} className="text-[13px] font-bold text-[var(--color-text)]" />
          </div>
        )}
      </div>

      {/* ── Details (always visible) ─────────────────── */}
      <div className="grid gap-2 text-[13px] text-[#2f3745]">
        {charger.session && (
          <>
            <InfoRow label="In use by" value={formatUserDisplay(charger.session.userName, charger.session.userEmail)} />
            <InfoRow label="Ends at" value={fmtTime(charger.session.endTime)} />
            <div className="grid gap-[2px]">
              <span className="text-[var(--color-muted)] text-[11px] uppercase tracking-[0.06em] mb-[2px]">
                Countdown
              </span>
              <SessionTimer endTime={charger.session.endTime} className="text-base" />
            </div>
            {charger.nextReservation && (
              <InfoRow
                label="Next reservation"
                value={`${formatUserDisplay(charger.nextReservation.userName, charger.nextReservation.userEmail)} at ${fmtTime(charger.nextReservation.startTime)}`}
                secondary
              />
            )}
          </>
        )}

        {!charger.session && charger.reservation && (
          <>
            <InfoRow
              label="Reserved for"
              value={formatUserDisplay(charger.reservation.userName, charger.reservation.userEmail)}
            />
            <InfoRow label="Reserved at" value={fmtTime(charger.reservation.startTime)} />
            {charger.nextReservation && (
              <InfoRow
                label="Next reservation"
                value={`${formatUserDisplay(charger.nextReservation.userName, charger.nextReservation.userEmail)} at ${fmtTime(charger.nextReservation.startTime)}`}
                secondary
              />
            )}
          </>
        )}

        {!charger.session && !charger.reservation && (
          <>
            {charger.walkup && charger.walkup.isOpen && (
              <>
                <InfoRow label="Walk-up ends at" value={fmtTime(charger.walkup.endTime)} />
                <div className="grid gap-[2px]">
                  <span className="text-[var(--color-muted)] text-[11px] uppercase tracking-[0.06em] mb-[2px]">
                    Time left
                  </span>
                  <SessionTimer endTime={charger.walkup.endTime} className="text-[13px]" />
                </div>
                {!charger.walkup.isOpenToAll && <WalkupPriorityRow charger={charger} boardData={boardData} />}
              </>
            )}
            {charger.walkup && !charger.walkup.isOpen && (
              <InfoRow label="Walk-up opens at" value={fmtTime(charger.walkup.openAt)} />
            )}
            {charger.nextReservation && (
              <InfoRow
                label="Next reservation"
                value={`${formatUserDisplay(charger.nextReservation.userName, charger.nextReservation.userEmail)} at ${fmtTime(charger.nextReservation.startTime)}`}
                secondary
              />
            )}
          </>
        )}
      </div>

      {/* ── Actions ──────────────────────────────────── */}
      {primaryAction && (
        <div className="flex flex-col gap-2">
          <button
            className={btnVariants[primaryAction.variant]}
            onClick={primaryAction.handler}
            disabled={loading}
          >
            {loading && <Spinner size="sm" />}
            {loading ? primaryAction.loadingLabel : primaryAction.label}
          </button>
          <div className="text-[var(--color-muted)] text-xs text-center">
            {primaryAction.helpText}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: boolean;
}) {
  return (
    <div className={`grid gap-[2px] ${secondary ? 'opacity-75' : ''}`}>
      <span className="text-[var(--color-muted)] text-[11px] uppercase tracking-[0.06em] mb-[2px]">
        {label}
      </span>
      <span>{value || '--'}</span>
    </div>
  );
}

function WalkupPriorityRow({
  charger,
  boardData,
}: {
  charger: ChargerView;
  boardData: BoardData;
}) {
  const isNetNew = boardData.user.isNetNew === true;
  const isReturning = boardData.user.isReturning === true;

  if (!charger.walkup) return null;

  if (!charger.walkup.isOpenToReturning) {
    // Tier 1: net-new only
    return (
      <InfoRow
        label="Priority"
        value={
          isNetNew
            ? "You haven't charged today \u2014 you get first pick!"
            : `Reserved for first-time users today. Opens to you at ${fmtTime(charger.walkup.allUsersOpenAt)}.`
        }
      />
    );
  }

  // Tier 2: net-new OR returning
  return (
    <InfoRow
      label="Priority"
      value={
        isNetNew || isReturning
          ? "You're eligible for this slot!"
          : `Priority window active. Opens to everyone at ${fmtTime(charger.walkup.returningUsersOpenAt)}.`
      }
    />
  );
}
