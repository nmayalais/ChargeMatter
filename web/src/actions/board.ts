'use server';

import { getConfig } from '@/lib/config';
import { getChargers, getAllSessions, getAllReservations, getOnboardingComplete } from '@/lib/queries';
import { getActiveSuspensionForUser } from '@/lib/auth-helpers';
import { buildBoard, isNetNewUser, isReturningUser } from '@/lib/board';
import { getUpcomingReservationsForUser } from '@/lib/user-reservations';
import { serializeSuspension, APP_TIMEZONE } from '@/lib/utils';
import type { Auth, BoardData } from '@/types';

/**
 * Server Action: fetch the full board data for the current user.
 *
 * This is the Next.js equivalent of `getBoardData()` from engine.js.
 * Auth is expected to be injected by the caller (e.g. from next-auth session).
 */
export async function getBoardData(auth: Auth): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  const now = new Date();

  // Fetch all data in parallel
  const [configMap, chargerRows, sessionRows, reservationRows, suspension, onboardingComplete] =
    await Promise.all([
      getConfig(),
      getChargers(),
      getAllSessions(),
      getAllReservations(),
      getActiveSuspensionForUser(auth.email),
      getOnboardingComplete(auth.email.toLowerCase()),
    ]);

  // Build the board
  const board = buildBoard({
    now,
    chargers: chargerRows,
    sessions: sessionRows,
    reservations: reservationRows,
    configMap,
  });

  // Get upcoming reservations for this user
  const userReservations = getUpcomingReservationsForUser(
    reservationRows,
    auth.email,
    now,
  );

  // Augment auth with suspension and net-new/returning status
  const enrichedAuth: Auth = { ...auth };
  if (suspension) {
    enrichedAuth.suspension = serializeSuspension(suspension);
  }
  enrichedAuth.isNetNew = isNetNewUser(
    auth.email,
    sessionRows,
    reservationRows,
    now,
  );
  enrichedAuth.isReturning = isReturningUser(
    auth.email,
    sessionRows,
    reservationRows,
    now,
  );

  return {
    user: enrichedAuth,
    chargers: board.chargers,
    reservations: userReservations,
    serverTime: board.serverTime,
    timezone: APP_TIMEZONE,
    config: board.config,
    onboardingComplete,
  };
}
