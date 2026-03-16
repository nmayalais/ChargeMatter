'use client';

import { useState } from 'react';
import type { BoardData, ChargerView } from '@/types';
import type { ToastType } from './toast';
import { Modal } from './modal';
import { Spinner } from './loading';
import { resetCharger, forceEndSession } from '@/actions/admin';
import { trackEvent, ANALYTICS_EVENTS } from './analytics';

interface AdminPanelProps {
  boardData: BoardData;
  onBoardUpdate: (data: BoardData) => void;
  addToast: (message: string, type?: ToastType) => void;
}

type AdminAction = 'reset' | 'forceEnd';

interface PendingAction {
  type: AdminAction;
  charger: ChargerView;
}

/**
 * Admin panel shown at the bottom of the dashboard for admin users.
 * Provides reset charger and force-end session controls with confirmation modals.
 */
export function AdminPanel({ boardData, onBoardUpdate, addToast }: AdminPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!boardData.user.isAdmin) return null;

  const auth = boardData.user;

  const handleAction = async () => {
    if (!pendingAction) return;
    setIsLoading(true);
    try {
      let updatedBoard: BoardData;
      if (pendingAction.type === 'reset') {
        updatedBoard = await resetCharger(pendingAction.charger.id, auth);
        trackEvent(ANALYTICS_EVENTS.chargerReset, {
          charger_id: pendingAction.charger.id,
          charger_name: pendingAction.charger.name,
        });
        addToast(`${pendingAction.charger.name} has been reset.`, 'success');
      } else {
        updatedBoard = await forceEndSession(pendingAction.charger.id, auth);
        trackEvent(ANALYTICS_EVENTS.sessionForceEnded, {
          charger_id: pendingAction.charger.id,
          charger_name: pendingAction.charger.name,
        });
        addToast(`Session on ${pendingAction.charger.name} has been ended.`, 'success');
      }
      onBoardUpdate(updatedBoard);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      addToast(message, 'error');
    } finally {
      setIsLoading(false);
      setPendingAction(null);
    }
  };

  const confirmTitle =
    pendingAction?.type === 'reset'
      ? `Reset ${pendingAction.charger.name}?`
      : `Force end session on ${pendingAction?.charger.name}?`;

  const confirmMessage =
    pendingAction?.type === 'reset'
      ? 'This will clear the active session and reset the charger to a free state. This action cannot be undone.'
      : 'This will immediately end the current charging session. The user will be notified.';

  return (
    <>
      {/* Collapsible admin section */}
      <section
        className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] overflow-hidden"
        aria-label="Admin controls"
      >
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-bold tracking-[-0.01em] text-[var(--color-text)] hover:bg-[rgba(27,31,39,0.03)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 rounded-[var(--radius-lg)]"
          onClick={() => {
            setIsExpanded(!isExpanded);
            if (!isExpanded) {
              trackEvent(ANALYTICS_EVENTS.adminPanelOpened);
            }
          }}
          aria-expanded={isExpanded}
          aria-controls="admin-panel-content"
        >
          <span className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-xs font-bold"
              aria-hidden="true"
            >
              A
            </span>
            Admin Controls
          </span>
          <span
            className={`transition-transform duration-200 text-[var(--color-muted)] ${isExpanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            &#9662;
          </span>
        </button>

        {isExpanded && (
          <div id="admin-panel-content" className="border-t border-[var(--color-border)] px-4 py-3">
            <div className="space-y-3">
              {boardData.chargers.map((charger) => (
                <ChargerAdminRow
                  key={charger.id}
                  charger={charger}
                  onReset={() => setPendingAction({ type: 'reset', charger })}
                  onForceEnd={() => setPendingAction({ type: 'forceEnd', charger })}
                />
              ))}
            </div>

            {boardData.chargers.length === 0 && (
              <p className="text-sm text-[var(--color-muted)] text-center py-2">
                No chargers found.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Confirmation modal */}
      <Modal
        open={!!pendingAction}
        onClose={() => !isLoading && setPendingAction(null)}
        title={confirmTitle}
        actions={
          <>
            <button
              className="px-3 py-2 min-h-[var(--spacing-tap)] rounded-[var(--radius-md)] text-sm font-semibold border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[rgba(27,31,39,0.04)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              onClick={() => setPendingAction(null)}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              className="px-3 py-2 min-h-[var(--spacing-tap)] rounded-[var(--radius-md)] text-sm font-bold border-none bg-[var(--color-danger)] text-white hover:bg-[#b32e2e] transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--color-danger)] focus-visible:ring-offset-2 inline-flex items-center gap-1.5"
              onClick={handleAction}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner size="sm" /> Processing...
                </>
              ) : (
                'Confirm'
              )}
            </button>
          </>
        }
      >
        <p>{confirmMessage}</p>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-charger row inside the admin panel
// ---------------------------------------------------------------------------

function ChargerAdminRow({
  charger,
  onReset,
  onForceEnd,
}: {
  charger: ChargerView;
  onReset: () => void;
  onForceEnd: () => void;
}) {
  const hasSession = !!charger.session;
  const statusColor = statusColorClass(charger.statusKey);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-[var(--radius-md)] border border-[rgba(27,31,39,0.08)] bg-[var(--color-surface-muted)]">
      {/* Charger info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate">{charger.name}</span>
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusColor}`}
          >
            {charger.status}
          </span>
        </div>
        {hasSession && charger.session && (
          <div className="mt-1 text-xs text-[var(--color-muted)] space-y-0.5">
            <div>
              User: <span className="font-medium">{charger.session.userName || charger.session.userEmail}</span>
            </div>
            <div>
              Started: {new Date(charger.session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {' — '}
              Ends: {new Date(charger.session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            {charger.session.overdue && (
              <div className="text-[var(--color-danger)] font-semibold">Overdue</div>
            )}
          </div>
        )}
        {charger.reservation && (
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            Reserved by: {charger.reservation.userName || charger.reservation.userEmail}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 shrink-0">
        <button
          className="px-2.5 py-1.5 min-h-[36px] rounded-[var(--radius-sm)] text-xs font-semibold border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[rgba(27,31,39,0.04)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
          onClick={onReset}
          aria-label={`Reset ${charger.name}`}
        >
          Reset
        </button>
        <button
          className="px-2.5 py-1.5 min-h-[36px] rounded-[var(--radius-sm)] text-xs font-semibold border-none bg-[var(--color-danger)] text-white hover:bg-[#b32e2e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--color-danger)] focus-visible:ring-offset-1"
          onClick={onForceEnd}
          disabled={!hasSession}
          aria-label={`Force end session on ${charger.name}`}
        >
          Force End
        </button>
      </div>
    </div>
  );
}

function statusColorClass(statusKey: string): string {
  switch (statusKey) {
    case 'free':
      return 'bg-[var(--color-status-free-bg)] text-[var(--color-status-free-text)] border border-[var(--color-status-free-border)]';
    case 'in_use':
      return 'bg-[var(--color-status-in-use-bg)] text-[var(--color-status-in-use-text)] border border-[var(--color-status-in-use-border)]';
    case 'reserved':
      return 'bg-[var(--color-status-reserved-bg)] text-[var(--color-status-reserved-text)] border border-[var(--color-status-reserved-border)]';
    case 'overdue':
      return 'bg-[var(--color-status-overdue-bg)] text-[var(--color-status-overdue-text)] border border-[var(--color-status-overdue-border)]';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
