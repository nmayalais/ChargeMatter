'use client';

import { useMemo } from 'react';
import type { ChargerView } from '@/types';

export interface AvailableSlot {
  chargerId: string;
  startTime: string;
  endTime: string;
}

interface SlotPickerProps {
  slots: AvailableSlot[];
  chargers: ChargerView[];
  selectedChargerId: string | null;
  selectedSlot: AvailableSlot | null;
  onSelectSlot: (slot: AvailableSlot) => void;
  isLoading: boolean;
  serverTime: string;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
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

interface SlotGroup {
  label: string;
  slots: AvailableSlot[];
}

function groupSlots(slots: AvailableSlot[], serverTime: string): SlotGroup[] {
  const now = new Date(serverTime);
  const todayStr = now.toLocaleDateString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const buckets: {
    next: AvailableSlot[];
    later: AvailableSlot[];
    tonight: AvailableSlot[];
    other: Record<string, AvailableSlot[]>;
  } = { next: [], later: [], tonight: [], other: {} };

  for (const slot of slots) {
    const start = new Date(slot.startTime);
    const slotDay = start.toLocaleDateString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    if (slotDay !== todayStr) {
      const key = slot.startTime.slice(0, 10);
      if (!buckets.other[key]) buckets.other[key] = [];
      buckets.other[key].push(slot);
      continue;
    }

    const diffMinutes = Math.round(
      (start.getTime() - now.getTime()) / 60000,
    );
    if (diffMinutes <= 120) {
      buckets.next.push(slot);
    } else if (start.getHours() < 17) {
      buckets.later.push(slot);
    } else {
      buckets.tonight.push(slot);
    }
  }

  const groups: SlotGroup[] = [];
  if (buckets.next.length) groups.push({ label: 'Next 2 hours', slots: buckets.next });
  if (buckets.later.length) groups.push({ label: 'Later today', slots: buckets.later });
  if (buckets.tonight.length) groups.push({ label: 'Tonight', slots: buckets.tonight });
  for (const key of Object.keys(buckets.other).sort()) {
    const d = new Date(`${key}T12:00:00`);
    const label = d.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    groups.push({ label, slots: buckets.other[key] });
  }
  return groups;
}

function slotKey(slot: AvailableSlot) {
  return `${slot.chargerId}|${slot.startTime}`;
}

/**
 * Displays available time slots grouped by time window.
 * Each slot row shows time range, charger name, duration, and a Reserve button.
 */
export function SlotPicker({
  slots,
  chargers,
  selectedChargerId,
  selectedSlot,
  onSelectSlot,
  isLoading,
  serverTime,
  hasMore,
  onLoadMore,
  loadingMore,
}: SlotPickerProps) {
  // Filter by selected charger
  const filteredSlots = useMemo(() => {
    if (!selectedChargerId) return slots;
    return slots.filter((s) => s.chargerId === selectedChargerId);
  }, [slots, selectedChargerId]);

  const groups = useMemo(
    () => groupSlots(filteredSlots, serverTime),
    [filteredSlots, serverTime],
  );

  // Loading skeleton
  if (isLoading && slots.length === 0) {
    return (
      <div className="grid gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[60px] rounded-[var(--radius-sm)] bg-gradient-to-r from-[var(--color-border)] via-[var(--color-surface-muted)] to-[var(--color-border)] animate-shimmer"
          />
        ))}
      </div>
    );
  }

  if (filteredSlots.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-muted)]">
        No available slots found. Check back soon.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">
            {group.label}
          </div>
          <div className="grid gap-1.5">
            {group.slots.map((slot) => {
              const charger = chargers.find((c) => c.id === slot.chargerId);
              const chargerName =
                charger?.name || `Charger ${slot.chargerId}`;
              const isSelected =
                selectedSlot && slotKey(selectedSlot) === slotKey(slot);

              return (
                <button
                  key={slotKey(slot)}
                  type="button"
                  onClick={() => onSelectSlot(slot)}
                  className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-[var(--radius-sm)] text-left transition-all duration-150 border ${
                    isSelected
                      ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                      : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-dark)] hover:shadow-sm'
                  }`}
                  aria-pressed={!!isSelected}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {formatTime(slot.startTime)} &ndash;{' '}
                      {formatTime(slot.endTime)}
                    </div>
                    <div className="text-xs text-[var(--color-muted)] mt-0.5">
                      {chargerName}
                      <span className="mx-1 opacity-40">&middot;</span>
                      {formatDuration(slot.startTime, slot.endTime)}
                    </div>
                  </div>
                  <div
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${
                      isSelected
                        ? 'bg-[var(--color-primary)]'
                        : 'bg-[var(--color-status-free-text)]'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Show More */}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="w-full min-h-[var(--spacing-tap)] rounded-[var(--radius-sm)] text-[13px] font-bold bg-transparent text-[var(--color-muted)] border border-[var(--color-border)] hover:border-[var(--color-dark)] transition-colors disabled:opacity-50"
        >
          {loadingMore ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-[var(--color-muted)] border-t-transparent rounded-full animate-spin" />
              Loading...
            </span>
          ) : (
            'Show more'
          )}
        </button>
      )}
    </div>
  );
}
