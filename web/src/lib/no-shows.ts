/**
 * No-show detection logic.
 *
 * Ported from engine.js: markNoShowReservations_().
 * Called by the cron job to mark reservations as no-show when
 * the check-in grace period has expired.
 */

import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConfig, getReservationConfig } from '@/lib/config';
import { APP_DEFAULTS } from '@/lib/config';
import { getActiveReservations, getChargers } from '@/lib/queries';
import {
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  formatUserDisplay,
} from '@/lib/utils';
import { recordStrike } from '@/lib/strikes';
import {
  notifyChannel,
  type NotifyChannelConfig,
} from '@/lib/notifications';
import type { Charger, Reservation } from '@/types';

// ---------------------------------------------------------------------------
// Helper: build NotifyChannelConfig from config map
// ---------------------------------------------------------------------------

function buildNotifyConfig(configMap: Record<string, string>): NotifyChannelConfig {
  return {
    slackBotToken: configMap.slack_bot_token || '',
    slackWebhookUrl: configMap.slack_webhook_url || '',
    slackWebhookChannel: configMap.slack_webhook_channel || '',
    appName: configMap.app_name || String(APP_DEFAULTS.app_name),
  };
}

// ---------------------------------------------------------------------------
// processNoShows
// ---------------------------------------------------------------------------

export interface NoShowResult {
  noShowCount: number;
  errors: string[];
}

/**
 * Scan active reservations and mark any past-grace-period ones as no-show.
 * Records a no-show strike for each newly marked reservation.
 *
 * Mirrors markNoShowReservations_() from engine.js.
 */
export async function processNoShows(now: Date): Promise<NoShowResult> {
  const configMap = await getConfig();
  const reservationConfig = getReservationConfig(configMap);
  const appName = configMap.app_name || String(APP_DEFAULTS.app_name);
  const notifyConfig = buildNotifyConfig(configMap);

  const allReservations = await getActiveReservations();
  const chargerRows = await getChargers();

  const chargersById: Record<string, Charger> = {};
  for (const charger of chargerRows) {
    chargersById[charger.id] = charger;
  }

  let noShowCount = 0;
  const errors: string[] = [];

  for (const reservation of allReservations) {
    try {
      // Skip if already handled
      if (
        isReservationCanceled(reservation) ||
        isReservationNoShow(reservation) ||
        isReservationComplete(reservation)
      ) {
        continue;
      }

      // Skip if already checked in
      if (reservation.checkedInAt) {
        continue;
      }

      const startTime = reservation.startTime;
      if (!startTime) continue;

      const latestCheckin = new Date(startTime.getTime() + reservationConfig.lateGraceMinutes * 60_000);

      if (now.getTime() > latestCheckin.getTime()) {
        // Mark as no-show
        const updates: Record<string, unknown> = {
          status: 'no_show',
          noShowAt: now,
          updatedAt: now,
        };

        // Record strike if not already recorded
        if (!reservation.noShowStrikeAt) {
          await recordStrike({
            type: 'no_show',
            sourceType: 'reservation',
            sourceId: reservation.id,
            userId: reservation.userId,
            userName: reservation.userName,
            reason: 'No-show for reservation',
            occurredAt: now,
          });
          updates.noShowStrikeAt = now;
        }

        await db
          .update(reservations)
          .set(updates as Partial<Reservation>)
          .where(eq(reservations.id, reservation.id));

        // Notify
        const charger = chargersById[reservation.chargerId];
        const chargerName = charger?.name || `Charger ${reservation.chargerId}`;
        const releasedUser = formatUserDisplay(reservation.userName, reservation.userId);

        await notifyChannel(
          `${appName}: ${releasedUser}'s reservation on ${chargerName} was released (no-show after ${reservationConfig.lateGraceMinutes} minutes).`,
          notifyConfig,
          reservation.userId,
        );

        noShowCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Reservation ${reservation.id}: ${message}`);
      console.error(`[NO-SHOW] Error processing reservation ${reservation.id}:`, err);
    }
  }

  return { noShowCount, errors };
}
