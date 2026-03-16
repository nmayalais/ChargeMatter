/**
 * Strike recording and automatic suspension logic.
 *
 * Ported from engine.js: recordStrike_(), maybeApplySuspension_(),
 * getMonthlyStrikeCount_(), addBusinessDays_().
 */

import { db } from '@/lib/db';
import { strikes, suspensions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getConfig } from '@/lib/config';
import { APP_DEFAULTS } from '@/lib/config';
import { monthKey, addBusinessDays, formatTime, formatUserDisplay } from '@/lib/utils';
import { getActiveSuspensionForUser } from '@/lib/auth-helpers';
import {
  notifyChannel,
  type NotifyChannelConfig,
} from '@/lib/notifications';

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
// Record a strike
// ---------------------------------------------------------------------------

export interface RecordStrikeParams {
  userId: string;
  userName: string;
  type: 'late' | 'no_show';
  sourceType: string;
  sourceId: string;
  reason: string;
  occurredAt: Date;
}

/**
 * Record a strike for a user, de-duplicating by (source_id, type).
 * If the monthly strike threshold is reached, auto-creates a suspension.
 *
 * Returns `true` if a new strike was recorded, `false` if it was a duplicate.
 */
export async function recordStrike(params: RecordStrikeParams): Promise<boolean> {
  const { userId, userName, type, sourceType, sourceId, reason, occurredAt } = params;
  const normalizedEmail = userId.toLowerCase();
  const mKey = monthKey(occurredAt);

  // De-duplicate: check if a strike for this (source_id, type) already exists
  const existing = await db
    .select()
    .from(strikes)
    .where(and(eq(strikes.sourceId, sourceId), eq(strikes.type, type)))
    .limit(1);

  if (existing.length > 0) {
    return false;
  }

  // Insert the new strike
  await db.insert(strikes).values({
    userId: normalizedEmail,
    userName: userName || '',
    type,
    sourceType,
    sourceId,
    reason: reason || '',
    occurredAt,
    monthKey: mKey,
  });

  // Count monthly strikes (including the one we just inserted)
  const monthStrikes = await db
    .select()
    .from(strikes)
    .where(and(eq(strikes.userId, normalizedEmail), eq(strikes.monthKey, mKey)));

  const count = monthStrikes.length;

  // Maybe apply suspension
  await maybeApplySuspension(normalizedEmail, userName, occurredAt, count);

  return true;
}

// ---------------------------------------------------------------------------
// Automatic suspension
// ---------------------------------------------------------------------------

/**
 * If the strike count meets or exceeds the threshold, create a suspension.
 * Mirrors maybeApplySuspension_() from engine.js.
 */
export async function maybeApplySuspension(
  userId: string,
  userName: string,
  now: Date,
  strikeCount: number,
): Promise<boolean> {
  const configMap = await getConfig();
  const appName = configMap.app_name || String(APP_DEFAULTS.app_name);

  const threshold = parseInt(configMap.strike_threshold, 10);
  const suspensionDays = parseInt(configMap.suspension_business_days, 10);
  const required = isNaN(threshold) ? Number(APP_DEFAULTS.strike_threshold) : threshold;
  const days = isNaN(suspensionDays) ? Number(APP_DEFAULTS.suspension_business_days) : suspensionDays;

  if (strikeCount < required) {
    return false;
  }

  // Check if already suspended
  const existing = await getActiveSuspensionForUser(userId);
  if (existing) {
    return false;
  }

  // Create suspension
  const startAt = now;
  const endAt = addBusinessDays(startAt, days);

  await db.insert(suspensions).values({
    userId: userId.toLowerCase(),
    userName: userName || '',
    startAt,
    endAt,
    reason: 'Two-strike rule',
    active: true,
  });

  // Notify
  const userDisplay = formatUserDisplay(userName, userId);
  const notifyConfig = buildNotifyConfig(configMap);
  await notifyChannel(
    `${appName}: ${userDisplay} has reached ${required} strikes and is suspended until ${formatTime(endAt)}.`,
    notifyConfig,
  );

  return true;
}
