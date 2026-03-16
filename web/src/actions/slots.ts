'use server';

import { getConfig } from '@/lib/config';
import { getChargers, getAllReservations } from '@/lib/queries';
import { getNextAvailableSlots, type AvailableSlot } from '@/lib/availability';
import type { Auth } from '@/types';

/**
 * Server Action: fetch available booking slots.
 *
 * Returns available time slots across all chargers, sorted by start time.
 * Mirrors `getAvailabilitySummary()` from engine.js.
 */
export async function getAvailableSlots(
  _auth: Auth,
  offset = 0,
  limit = 20,
): Promise<AvailableSlot[]> {
  const now = new Date();
  const [configMap, chargerRows, reservationRows] = await Promise.all([
    getConfig(),
    getChargers(),
    getAllReservations(),
  ]);

  return getNextAvailableSlots({
    now,
    chargers: chargerRows,
    reservations: reservationRows,
    configMap,
    rangeDays: 1,
    limit,
    offset,
  });
}
