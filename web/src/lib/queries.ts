import { db } from '@/lib/db';
import { chargers, sessions, reservations, config } from '@/lib/db/schema';
import { eq, not, inArray } from 'drizzle-orm';
import type { Charger, Session, Reservation } from '@/types';

/**
 * Fetch all charger rows.
 */
export async function getChargers(): Promise<Charger[]> {
  return db.select().from(chargers);
}

/**
 * Fetch all non-complete sessions (active or overdue).
 */
export async function getActiveSessions(): Promise<Session[]> {
  return db.select().from(sessions).where(eq(sessions.complete, false));
}

/**
 * Fetch all sessions (including complete). Needed for net-new / returning checks.
 */
export async function getAllSessions(): Promise<Session[]> {
  return db.select().from(sessions);
}

/**
 * Fetch all reservations that are still "live" (not canceled, not no_show, not complete).
 */
export async function getActiveReservations(): Promise<Reservation[]> {
  return db
    .select()
    .from(reservations)
    .where(not(inArray(reservations.status, ['canceled', 'no_show', 'complete'])));
}

/**
 * Fetch all reservations (including canceled/no-show/complete).
 * Needed for net-new/returning user checks and board walkup logic.
 */
export async function getAllReservations(): Promise<Reservation[]> {
  return db.select().from(reservations);
}

/**
 * Fetch all config rows (thin wrapper — prefer getConfig() from config.ts for the merged map).
 */
export async function getConfigRows() {
  return db.select().from(config);
}
