import type { Reservation } from '@/types';
import {
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  toDate,
  serializeReservation,
} from '@/lib/utils';
import type { SerializedReservation } from '@/types';

/**
 * Return upcoming reservations for a user — non-canceled, non-no-show,
 * non-complete, with endTime >= now. Sorted by start time ascending.
 *
 * Mirrors `getUpcomingReservationsForUser_()` from engine.js.
 */
export function getUpcomingReservationsForUser(
  allReservations: Reservation[],
  email: string,
  now: Date,
): SerializedReservation[] {
  const userEmail = (email || '').toLowerCase();

  return allReservations
    .filter((reservation) => {
      if (
        !reservation.id ||
        isReservationCanceled(reservation) ||
        isReservationNoShow(reservation) ||
        isReservationComplete(reservation)
      ) {
        return false;
      }
      const endTime = toDate(reservation.endTime);
      if (!endTime || endTime.getTime() < now.getTime()) {
        return false;
      }
      return reservation.userId.toLowerCase() === userEmail;
    })
    .sort((a, b) => {
      const aTime = toDate(a.startTime);
      const bTime = toDate(b.startTime);
      return (aTime ? aTime.getTime() : 0) - (bTime ? bTime.getTime() : 0);
    })
    .map(serializeReservation);
}
