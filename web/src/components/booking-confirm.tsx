'use client';

import { useState } from 'react';
import type { ChargerView } from '@/types';

export interface BookingSlot {
  chargerId: string;
  startTime: string;
  endTime: string;
}

interface BookingConfirmProps {
  slot: BookingSlot;
  chargers: ChargerView[];
  editingReservationId: string | null;
  onConfirm: () => Promise<void>;
  onBack: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h} hour${h > 1 ? 's' : ''}`;
}

/**
 * Booking confirmation panel shown after selecting a slot.
 * Displays a summary and confirm/back buttons.
 */
export function BookingConfirm({
  slot,
  chargers,
  editingReservationId,
  onConfirm,
  onBack,
}: BookingConfirmProps) {
  const [isLoading, setIsLoading] = useState(false);

  const charger = chargers.find((c) => c.id === slot.chargerId);
  const chargerName = charger?.name || `Charger ${slot.chargerId}`;
  const isEdit = !!editingReservationId;

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-surface)] rounded-[var(--radius-md)] border border-[var(--color-primary)] ring-1 ring-[var(--color-primary)] p-4 grid gap-3 animate-fade-up">
      <div className="text-sm font-bold">
        {isEdit ? 'Update reservation' : 'Confirm booking'}
      </div>

      {/* Summary */}
      <div className="grid gap-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-[var(--color-muted)]">Charger</span>
          <span className="font-semibold">{chargerName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-muted)]">Date</span>
          <span className="font-semibold">{formatDate(slot.startTime)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-muted)]">Time</span>
          <span className="font-semibold">
            {formatTime(slot.startTime)} &ndash; {formatTime(slot.endTime)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-muted)]">Duration</span>
          <span className="font-semibold">
            {formatDuration(slot.startTime, slot.endTime)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="flex-1 min-h-[var(--spacing-tap)] rounded-[var(--radius-sm)] text-[13px] font-bold bg-transparent text-[var(--color-muted)] border border-[var(--color-border)] hover:border-[var(--color-dark)] transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isLoading}
          className="flex-[2] min-h-[var(--spacing-tap)] rounded-[var(--radius-sm)] text-[13px] font-bold bg-[var(--color-primary)] text-white border border-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {isEdit ? 'Updating...' : 'Booking...'}
            </span>
          ) : isEdit ? (
            'Update reservation'
          ) : (
            'Confirm booking'
          )}
        </button>
      </div>
    </div>
  );
}
