'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import type { BoardData } from '@/types';
import type { ToastType } from './toast';
import { ChargerCard } from './charger-card';
import { StatusBanner } from './status-banner';
import { endSession } from '@/actions/sessions';

interface ChargerGridProps {
  boardData: BoardData;
  onAction: () => Promise<void>;
  addToast: (message: string, type?: ToastType) => void;
}

/**
 * "Charge Now" tab content: shows user status banner, summary chips, and
 * a grid of charger cards.
 */
export function ChargerGrid({ boardData, onAction, addToast }: ChargerGridProps) {
  const [bannerLoading, setBannerLoading] = useState(false);
  const prevStatusesRef = useRef<Record<string, string>>({});

  // Track status changes for flash animation
  const changedIds = useMemo(() => {
    const changed = new Set<string>();
    const prev = prevStatusesRef.current;
    for (const charger of boardData.chargers) {
      if (prev[charger.id] && prev[charger.id] !== charger.statusKey) {
        changed.add(charger.id);
      }
    }
    // Update ref for next render
    const next: Record<string, string> = {};
    for (const charger of boardData.chargers) {
      next[charger.id] = charger.statusKey;
    }
    prevStatusesRef.current = next;
    return changed;
  }, [boardData.chargers]);

  // Handler for End Session from the status banner
  const handleBannerEndSession = useCallback(
    async (sessionId: string) => {
      setBannerLoading(true);
      try {
        await endSession(sessionId, {
          email: boardData.user.email,
          name: boardData.user.name,
          isAdmin: boardData.user.isAdmin,
        });
        addToast('Session ended. The charger is now free for others.', 'success');
        await onAction();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to end session';
        addToast(msg, 'error');
      } finally {
        setBannerLoading(false);
      }
    },
    [boardData.user, onAction, addToast],
  );

  // Compute summary counts
  const counts = useMemo(() => {
    const c = { free: 0, in_use: 0, reserved: 0, overdue: 0 };
    for (const charger of boardData.chargers) {
      if (charger.statusKey in c) {
        c[charger.statusKey as keyof typeof c] += 1;
      }
    }
    return c;
  }, [boardData.chargers]);

  if (!boardData.chargers.length) {
    return (
      <div className="py-8 text-center text-[var(--color-muted)] text-sm">
        No chargers configured yet.
      </div>
    );
  }

  const summaryItems = [
    { key: 'free' as const, label: 'Open' },
    { key: 'in_use' as const, label: 'In use' },
    { key: 'reserved' as const, label: 'Reserved' },
    { key: 'overdue' as const, label: 'Overdue' },
  ];

  return (
    <div>
      {/* Status banner */}
      <StatusBanner
        boardData={boardData}
        onEndSession={handleBannerEndSession}
        isLoading={bannerLoading}
      />

      {/* Summary chips */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {summaryItems.map((item, i) => (
          <SummaryChip
            key={item.key}
            statusKey={item.key}
            label={item.label}
            count={counts[item.key]}
            delay={i * 60}
          />
        ))}
      </div>

      {/* Charger card grid */}
      <div className="grid grid-cols-1 gap-4">
        {boardData.chargers.map((charger) => (
          <ChargerCard
            key={charger.id}
            charger={charger}
            userEmail={boardData.user.email}
            boardData={boardData}
            onAction={onAction}
            addToast={addToast}
            statusChanged={changedIds.has(charger.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary chip sub-component
// ---------------------------------------------------------------------------

const chipStatusStyles: Record<string, string> = {
  free: 'bg-[var(--color-status-free-bg)] text-[var(--color-status-free-text)] border-[var(--color-status-free-border)]',
  in_use:
    'bg-[var(--color-status-in-use-bg)] text-[var(--color-status-in-use-text)] border-[var(--color-status-in-use-border)]',
  reserved:
    'bg-[var(--color-status-reserved-bg)] text-[var(--color-status-reserved-text)] border-[var(--color-status-reserved-border)]',
  overdue:
    'bg-[var(--color-status-overdue-bg)] text-[var(--color-status-overdue-text)] border-[var(--color-status-overdue-border)]',
};

function SummaryChip({
  statusKey,
  label,
  count,
  delay,
}: {
  statusKey: string;
  label: string;
  count: number;
  delay: number;
}) {
  return (
    <div
      className={`min-w-[92px] p-2 px-3 rounded-[var(--radius-md)] border shadow-[var(--shadow-soft)] grid gap-[2px] text-xs animate-fade-up ${
        chipStatusStyles[statusKey] || ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <strong className="text-lg">{count}</strong>
      <span>{label}</span>
    </div>
  );
}
