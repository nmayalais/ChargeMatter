'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { BoardData } from '@/types';
import type { ToastType } from './toast';
import {
  createReservation,
  updateReservation,
  cancelReservation,
  checkInReservation,
  completeCheckedInReservation,
} from '@/actions/reservations';
import { getAvailableSlots } from '@/actions/slots';
import { ReservationCard } from './reservation-card';
import { ChargerSelector } from './charger-selector';
import { SlotPicker, type AvailableSlot } from './slot-picker';
import { BookingConfirm } from './booking-confirm';
import { Modal } from './modal';

interface ReservationViewProps {
  boardData: BoardData;
  onAction: () => Promise<void>;
  addToast: (message: string, type?: ToastType) => void;
}

const PAGE_SIZE = 20;

/**
 * Main reservation tab: shows upcoming reservations, charger filter,
 * available slots, and booking confirmation flow.
 */
export function ReservationView({
  boardData,
  onAction,
  addToast,
}: ReservationViewProps) {
  const { chargers, reservations, serverTime, config, user } = boardData;

  // Slot fetching state
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsOffset, setSlotsOffset] = useState(0);
  const [hasMoreSlots, setHasMoreSlots] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Selection state
  const [selectedChargerId, setSelectedChargerId] = useState<string | null>(
    null,
  );
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [editingReservationId, setEditingReservationId] = useState<
    string | null
  >(null);

  // Cancel confirmation modal
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  // Load slots
  const loadSlots = useCallback(
    async (offset = 0, append = false) => {
      if (!append) setSlotsLoading(true);
      else setLoadingMore(true);

      try {
        const result = await getAvailableSlots(
          { email: user.email, name: user.name ?? '', isAdmin: user.isAdmin },
          offset,
          PAGE_SIZE,
        );
        if (append) {
          setSlots((prev) => [...prev, ...result]);
        } else {
          setSlots(result);
        }
        setSlotsOffset(offset + PAGE_SIZE);
        setHasMoreSlots(result.length >= PAGE_SIZE);
      } catch {
        addToast('Failed to load available slots', 'error');
      } finally {
        setSlotsLoading(false);
        setLoadingMore(false);
      }
    },
    [user.email, user.name, user.isAdmin, addToast],
  );

  // Initial slot load
  useEffect(() => {
    loadSlots(0);
  }, [loadSlots]);

  // Slot count by charger (for the selector pills)
  const slotCountByCharger = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const slot of slots) {
      counts[slot.chargerId] = (counts[slot.chargerId] ?? 0) + 1;
    }
    return counts;
  }, [slots]);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    loadSlots(slotsOffset, true);
  }, [loadSlots, slotsOffset]);

  // ----- Actions -----

  const handleBook = useCallback(async () => {
    if (!selectedSlot) return;
    try {
      if (editingReservationId) {
        await updateReservation(
          { email: user.email, name: user.name ?? '', isAdmin: user.isAdmin },
          editingReservationId,
          selectedSlot.chargerId,
          selectedSlot.startTime,
        );
        addToast(
          'Reservation updated! Come back 15 min before your slot to check in.',
          'success',
        );
      } else {
        await createReservation(
          { email: user.email, name: user.name ?? '', isAdmin: user.isAdmin },
          selectedSlot.chargerId,
          selectedSlot.startTime,
        );
        addToast(
          "You're booked! Come back 15 min before your slot to check in.",
          'success',
        );
      }
      setSelectedSlot(null);
      setEditingReservationId(null);
      await onAction();
      loadSlots(0);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : 'Booking failed';
      addToast(msg, 'error');
    }
  }, [
    selectedSlot,
    editingReservationId,
    user,
    addToast,
    onAction,
    loadSlots,
  ]);

  const handleCheckIn = useCallback(
    async (reservationId: string) => {
      try {
        await checkInReservation(
          { email: user.email, name: user.name ?? '', isAdmin: user.isAdmin },
          reservationId,
        );
        addToast('Checked in! Your charging session is now active.', 'success');
        await onAction();
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : 'Check-in failed';
        addToast(msg, 'error');
      }
    },
    [user, addToast, onAction],
  );

  const handleCancel = useCallback(
    async (reservationId: string) => {
      setCancelTarget(reservationId);
    },
    [],
  );

  const confirmCancel = useCallback(async () => {
    if (!cancelTarget) return;
    const id = cancelTarget;
    setCancelTarget(null);
    try {
      await cancelReservation(
        { email: user.email, name: user.name ?? '', isAdmin: user.isAdmin },
        id,
      );
      addToast(
        'Reservation cancelled. The slot is available for others.',
        'success',
      );
      await onAction();
      loadSlots(0);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : 'Cancel failed';
      addToast(msg, 'error');
    }
  }, [cancelTarget, user, addToast, onAction, loadSlots]);

  const handleModify = useCallback((reservationId: string) => {
    setEditingReservationId(reservationId);
    setSelectedSlot(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingReservationId(null);
    setSelectedSlot(null);
  }, []);

  const handleComplete = useCallback(
    async (reservationId: string) => {
      try {
        await completeCheckedInReservation(
          { email: user.email, name: user.name ?? '', isAdmin: user.isAdmin },
          reservationId,
        );
        addToast('Session ended. The charger is now free for others.', 'success');
        await onAction();
        loadSlots(0);
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : 'Could not end session';
        addToast(msg, 'error');
      }
    },
    [user, addToast, onAction, loadSlots],
  );

  const handleSelectSlot = useCallback((slot: AvailableSlot) => {
    setSelectedSlot((prev) =>
      prev &&
      prev.chargerId === slot.chargerId &&
      prev.startTime === slot.startTime
        ? null
        : slot,
    );
  }, []);

  // Reservation limits info
  const limitsText = useMemo(() => {
    const parts: string[] = ['Same-day only'];
    const maxUpcoming = config.reservationMaxUpcoming;
    const maxPerDay = config.reservationMaxPerDay;
    if (typeof maxUpcoming === 'number' && maxUpcoming > 0) {
      parts.push(`Max ${maxUpcoming} upcoming`);
    }
    if (typeof maxPerDay === 'number' && maxPerDay > 0) {
      parts.push(`Max ${maxPerDay} per day`);
    }
    return parts.join(' \u00b7 ');
  }, [config]);

  return (
    <div className="grid gap-4 pt-2">
      {/* My Reservations Section */}
      <section aria-label="Your reservations">
        <div className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">
          My Reservations
        </div>
        {reservations.length === 0 ? (
          <div className="text-sm text-[var(--color-muted)] py-3">
            No reservation yet. Choose a time below.
          </div>
        ) : (
          <div className="grid gap-2.5">
            {reservations.map((res) => (
              <ReservationCard
                key={res.reservationId}
                reservation={res}
                chargers={chargers}
                serverTime={serverTime}
                config={config}
                onCheckIn={handleCheckIn}
                onCancel={handleCancel}
                onModify={handleModify}
                onComplete={handleComplete}
              />
            ))}
          </div>
        )}
      </section>

      {/* Edit banner */}
      {editingReservationId && (
        <div className="flex items-center justify-between gap-2 bg-[var(--color-status-in-use-bg)] border border-[var(--color-status-in-use-border)] rounded-[var(--radius-sm)] px-3.5 py-2.5 text-sm text-[var(--color-status-in-use-text)] font-medium animate-fade-up">
          <span>Select a new slot to replace this reservation.</span>
          <button
            type="button"
            onClick={cancelEdit}
            className="text-[var(--color-status-in-use-text)] underline font-bold text-xs"
          >
            Cancel edit
          </button>
        </div>
      )}

      {/* Booking Section */}
      <section aria-label="Book a slot">
        {/* Limits info */}
        <div className="text-xs text-[var(--color-muted)] mb-3">
          {limitsText}
        </div>

        {/* Charger filter */}
        <div className="mb-3">
          <ChargerSelector
            chargers={chargers}
            selectedChargerId={selectedChargerId}
            onSelect={setSelectedChargerId}
            slotCountByCharger={slotCountByCharger}
          />
        </div>

        {/* Booking confirmation */}
        {selectedSlot && (
          <div className="mb-3">
            <BookingConfirm
              slot={selectedSlot}
              chargers={chargers}
              editingReservationId={editingReservationId}
              onConfirm={handleBook}
              onBack={() => setSelectedSlot(null)}
            />
          </div>
        )}

        {/* Slot list */}
        <SlotPicker
          slots={slots}
          chargers={chargers}
          selectedChargerId={selectedChargerId}
          selectedSlot={selectedSlot}
          onSelectSlot={handleSelectSlot}
          isLoading={slotsLoading}
          serverTime={serverTime}
          hasMore={hasMoreSlots}
          onLoadMore={handleLoadMore}
          loadingMore={loadingMore}
        />
      </section>

      {/* Cancel Confirmation Modal */}
      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel reservation?"
        actions={
          <>
            <button
              type="button"
              onClick={() => setCancelTarget(null)}
              className="min-h-[var(--spacing-tap)] px-4 rounded-[var(--radius-sm)] text-[13px] font-bold bg-transparent text-[var(--color-muted)] border border-[var(--color-border)] hover:border-[var(--color-dark)] transition-colors"
            >
              Keep reservation
            </button>
            <button
              type="button"
              onClick={confirmCancel}
              className="min-h-[var(--spacing-tap)] px-4 rounded-[var(--radius-sm)] text-[13px] font-bold bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[#fecaca] hover:bg-[#ffdcdc] transition-colors"
            >
              Cancel reservation
            </button>
          </>
        }
      >
        <p className="text-[var(--color-muted)]">
          Release this slot back to the schedule?
        </p>
        <p className="text-xs text-[var(--color-muted)] mt-1.5">
          You can always book another open time.
        </p>
      </Modal>
    </div>
  );
}
