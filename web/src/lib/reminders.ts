/**
 * Session reminder and reservation reminder logic.
 *
 * Ported from engine.js: sendRemindersCore_() — the session and reservation
 * reminder loop that runs on a cron schedule.
 */

import { db } from '@/lib/db';
import { sessions, reservations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConfig, getReservationConfig } from '@/lib/config';
import { APP_DEFAULTS } from '@/lib/config';
import { getActiveSessions, getActiveReservations, getChargers } from '@/lib/queries';
import {
  isTrue,
  isComplete,
  isReservationCanceled,
  isReservationNoShow,
  isReservationComplete,
  addMinutes,
  formatTime,
  formatUserDisplay,
  toDate,
} from '@/lib/utils';
import {
  notifyChannel,
  notifyUser,
  getSlackChannelMention,
  type NotifyChannelConfig,
} from '@/lib/notifications';
import { recordStrike } from '@/lib/strikes';
import type { Charger, Session, Reservation } from '@/types';

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
// Reminder text builders (mirrors buildReminderText_ from engine.js)
// ---------------------------------------------------------------------------

function buildSessionReminderText(
  type: 'tminus10' | 'tminus5' | 'expire' | 'grace' | 'overdue',
  session: Session,
  charger: Charger | undefined,
  endTime: Date,
  appName: string,
  channelMention: string,
  graceMinutes: number,
): string {
  const chargerName = charger?.name || `Charger ${session.chargerId}`;
  const endDisplay = formatTime(endTime);
  const userName = formatUserDisplay(session.userName, session.userId);

  switch (type) {
    case 'tminus10':
      return `${appName}: ${userName}'s session on ${chargerName} ends in 10 minutes (ends at ${endDisplay}). Please move within ${graceMinutes} minutes of ending.`;
    case 'tminus5':
      return `${appName}: ${userName}'s session on ${chargerName} ends in 5 minutes (ends at ${endDisplay}). Please move within ${graceMinutes} minutes of ending.`;
    case 'expire':
      return `${appName}: ${userName}'s session on ${chargerName} just ended at ${endDisplay}. Please move within ${graceMinutes} minutes.`;
    case 'grace':
      return `${appName}: ${userName}'s session on ${chargerName} is past the ${graceMinutes}-minute grace period. Please move now and post updates in ${channelMention}. If the cable reaches the next spot, unlock the charge port remotely.`;
    case 'overdue':
      return `${appName}: ${userName}'s session on ${chargerName} is still overdue. Please move now and post updates in ${channelMention}.`;
  }
}

function buildReservationReminderText(
  type: 'upcoming' | 'late',
  reservation: Reservation,
  charger: Charger | undefined,
  startTime: Date,
  lateGraceMinutes: number,
  appName: string,
): string {
  const chargerName = charger?.name || `Charger ${reservation.chargerId}`;
  const startDisplay = formatTime(startTime);
  const releaseTime = addMinutes(startTime, lateGraceMinutes);
  const releaseDisplay = formatTime(releaseTime);
  const userName = formatUserDisplay(reservation.userName, reservation.userId);

  if (type === 'upcoming') {
    return `${appName}: ${userName}'s reservation on ${chargerName} starts in 5 minutes at ${startDisplay}.`;
  }
  // type === 'late'
  return `${appName}: ${userName}'s reservation on ${chargerName} started at ${startDisplay} and will be released at ${releaseDisplay} if unused.`;
}

// ---------------------------------------------------------------------------
// processSessionReminders
// ---------------------------------------------------------------------------

export interface ReminderResult {
  sessionsProcessed: number;
  reservationsProcessed: number;
  reminders10Sent: number;
  reminders5Sent: number;
  reminders0Sent: number;
  graceNotifications: number;
  overdueReminders: number;
  lateStrikes: number;
  reservationUpcomingReminders: number;
  reservationLateReminders: number;
  errors: string[];
}

/**
 * Process session and reservation reminders.
 * Mirrors sendRemindersCore_() from engine.js.
 */
export async function processSessionReminders(now: Date): Promise<ReminderResult> {
  const configMap = await getConfig();
  const reservationConfig = getReservationConfig(configMap);
  const notifyConfig = buildNotifyConfig(configMap);
  const appName = configMap.app_name || String(APP_DEFAULTS.app_name);
  const channelMention = getSlackChannelMention(configMap.slack_channel_name);

  const sessionMoveGraceMinutes = (() => {
    const v = parseInt(configMap.session_move_grace_minutes, 10);
    return isNaN(v) ? Number(APP_DEFAULTS.session_move_grace_minutes) : v;
  })();

  const overdueRepeatMinutes = (() => {
    const v = parseInt(configMap.overdue_repeat_minutes, 10);
    return isNaN(v) ? Number(APP_DEFAULTS.overdue_repeat_minutes) : v;
  })();

  const reminder10Enabled = isTrue(configMap.reminder_10_enabled);
  const reminder5Enabled = isTrue(configMap.reminder_5_enabled);

  const allSessions = await getActiveSessions();
  const allReservations = await getActiveReservations();
  const chargerRows = await getChargers();

  const chargersById: Record<string, Charger> = {};
  for (const charger of chargerRows) {
    chargersById[charger.id] = charger;
  }

  // Early exit if nothing to process
  const hasActiveSessions = allSessions.some((s) => s.id && !isComplete(s));
  const hasPendingReservations = allReservations.some(
    (r) =>
      r.id &&
      !isReservationCanceled(r) &&
      !isReservationNoShow(r) &&
      !isReservationComplete(r) &&
      !r.checkedInAt,
  );

  const result: ReminderResult = {
    sessionsProcessed: 0,
    reservationsProcessed: 0,
    reminders10Sent: 0,
    reminders5Sent: 0,
    reminders0Sent: 0,
    graceNotifications: 0,
    overdueReminders: 0,
    lateStrikes: 0,
    reservationUpcomingReminders: 0,
    reservationLateReminders: 0,
    errors: [],
  };

  if (!hasActiveSessions && !hasPendingReservations) {
    return result;
  }

  // ---- Process sessions ----
  for (const session of allSessions) {
    try {
      if (!session.id || isComplete(session)) continue;

      const endTime = session.endTime;
      if (!endTime) continue;

      const charger = chargersById[session.chargerId];
      const minutesToEnd = Math.floor((endTime.getTime() - now.getTime()) / 60_000);
      const graceCutoff = addMinutes(endTime, sessionMoveGraceMinutes);
      const isOverdue = now.getTime() >= graceCutoff.getTime();

      const updates: Record<string, unknown> = {};

      // Update status
      if (isOverdue && session.status !== 'overdue') {
        updates.status = 'overdue';
        updates.active = true;
        updates.overdue = true;
        updates.complete = false;
      }
      if (!isOverdue && session.status !== 'active') {
        updates.status = 'active';
        updates.active = true;
        updates.overdue = false;
        updates.complete = false;
      }

      // 10-minute reminder — DM only (personal, pre-emptive)
      if (reminder10Enabled && !session.reminder10Sent && minutesToEnd <= 10 && minutesToEnd > 5) {
        const sent = await notifyUser(
          buildSessionReminderText('tminus10', session, charger, endTime, appName, channelMention, sessionMoveGraceMinutes),
          notifyConfig,
          session.userId,
        );
        if (sent) {
          updates.reminder10Sent = true;
          result.reminders10Sent++;
        }
      }

      // 5-minute reminder — DM only (personal, pre-emptive)
      if (reminder5Enabled && !session.reminder5Sent && minutesToEnd <= 5 && minutesToEnd > 0) {
        const sent = await notifyUser(
          buildSessionReminderText('tminus5', session, charger, endTime, appName, channelMention, sessionMoveGraceMinutes),
          notifyConfig,
          session.userId,
        );
        if (sent) {
          updates.reminder5Sent = true;
          result.reminders5Sent++;
        }
      }

      // 0-minute (session ended) reminder
      if (!session.reminder0Sent && minutesToEnd <= 0) {
        const sent = await notifyChannel(
          buildSessionReminderText('expire', session, charger, endTime, appName, channelMention, sessionMoveGraceMinutes),
          notifyConfig,
          session.userId,
        );
        if (sent) {
          updates.reminder0Sent = true;
          updates.overdueLastSentAt = now;
          result.reminders0Sent++;
        }
      }

      // Overdue handling
      if (isOverdue) {
        // Grace notification (one-time)
        if (!session.graceNotifiedAt) {
          const sent = await notifyChannel(
            buildSessionReminderText('grace', session, charger, endTime, appName, channelMention, sessionMoveGraceMinutes),
            notifyConfig,
            session.userId,
          );
          if (sent) {
            updates.graceNotifiedAt = now;
            updates.overdueLastSentAt = now;
            result.graceNotifications++;
          }
        }

        // Late strike (one-time)
        if (!session.lateStrikeAt) {
          await recordStrike({
            type: 'late',
            sourceType: 'session',
            sourceId: session.id,
            userId: session.userId,
            userName: session.userName,
            reason: 'Late move after grace period',
            occurredAt: now,
          });
          updates.lateStrikeAt = now;
          result.lateStrikes++;
        }

        // Repeating overdue reminder
        const lastSent = toDate(session.overdueLastSentAt);
        if (!lastSent || now.getTime() - lastSent.getTime() >= overdueRepeatMinutes * 60_000) {
          const sent = await notifyChannel(
            buildSessionReminderText('overdue', session, charger, endTime, appName, channelMention, sessionMoveGraceMinutes),
            notifyConfig,
            session.userId,
          );
          if (sent) {
            updates.overdueLastSentAt = now;
            result.overdueReminders++;
          }
        }
      }

      // Apply updates
      if (Object.keys(updates).length > 0) {
        await db
          .update(sessions)
          .set(updates as Partial<Session>)
          .where(eq(sessions.id, session.id));
      }

      result.sessionsProcessed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Session ${session.id}: ${message}`);
      console.error(`[REMINDERS] Error processing session ${session.id}:`, err);
    }
  }

  // ---- Process reservations ----
  for (const reservation of allReservations) {
    try {
      if (
        !reservation.id ||
        isReservationCanceled(reservation) ||
        isReservationNoShow(reservation) ||
        isReservationComplete(reservation)
      ) {
        continue;
      }

      if (reservation.checkedInAt) continue;

      const startTime = reservation.startTime;
      if (!startTime) continue;

      const charger = chargersById[reservation.chargerId];
      const minutesToStart = Math.floor((startTime.getTime() - now.getTime()) / 60_000);
      const minutesSinceStart = Math.floor((now.getTime() - startTime.getTime()) / 60_000);

      const resUpdates: Record<string, unknown> = {};

      // 5 minutes before start reminder — DM only (personal)
      if (!reservation.reminder5BeforeSent && minutesToStart <= 5 && minutesToStart > 0) {
        const sent = await notifyUser(
          buildReservationReminderText('upcoming', reservation, charger, startTime, reservationConfig.lateGraceMinutes, appName),
          notifyConfig,
          reservation.userId,
        );
        if (sent) {
          resUpdates.reminder5BeforeSent = true;
          result.reservationUpcomingReminders++;
        }
      }

      // 5 minutes after start (late) reminder — DM only (personal, still actionable)
      if (
        !reservation.reminder5AfterSent &&
        minutesSinceStart >= 5 &&
        minutesSinceStart < reservationConfig.lateGraceMinutes
      ) {
        const sent = await notifyUser(
          buildReservationReminderText('late', reservation, charger, startTime, reservationConfig.lateGraceMinutes, appName),
          notifyConfig,
          reservation.userId,
        );
        if (sent) {
          resUpdates.reminder5AfterSent = true;
          result.reservationLateReminders++;
        }
      }

      if (Object.keys(resUpdates).length > 0) {
        await db
          .update(reservations)
          .set(resUpdates as Partial<Reservation>)
          .where(eq(reservations.id, reservation.id));
      }

      result.reservationsProcessed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Reservation ${reservation.id}: ${message}`);
      console.error(`[REMINDERS] Error processing reservation ${reservation.id}:`, err);
    }
  }

  return result;
}
