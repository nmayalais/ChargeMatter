'use server';

import { db } from '@/lib/db';
import { sessions, chargers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getConfig } from '@/lib/config';
import { assertAdmin } from '@/lib/auth-helpers';
import { isComplete } from '@/lib/utils';
import {
  notifyChannel,
  buildMoveCarMessage,
  getSlackChannelMention,
  type NotifyChannelConfig,
} from '@/lib/notifications';
import { getBoardData } from '@/actions/board';
import type { Auth, BoardData } from '@/types';

// ---------------------------------------------------------------------------
// Helper: build NotifyChannelConfig from config map
// ---------------------------------------------------------------------------

function buildNotifyConfig(configMap: Record<string, string>): NotifyChannelConfig {
  return {
    slackBotToken: configMap.slack_bot_token || '',
    slackWebhookUrl: configMap.slack_webhook_url || '',
    slackWebhookChannel: configMap.slack_webhook_channel || '',
    appName: configMap.app_name || 'EV Charging',
  };
}

// ---------------------------------------------------------------------------
// resetCharger — admin: clear a charger's active session and reset state
// ---------------------------------------------------------------------------

/**
 * Admin action: reset a charger by clearing its active session.
 * If the charger has an active session, it is marked complete.
 * Returns the updated board.
 *
 * Mirrors resetCharger() from engine.js.
 */
export async function resetCharger(chargerId: string, auth: Auth): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  const configMap = await getConfig();
  assertAdmin(auth.email, configMap);

  const now = new Date();

  // Find the charger
  const chargerRows = await db
    .select()
    .from(chargers)
    .where(eq(chargers.id, chargerId));
  const charger = chargerRows[0];
  if (!charger) throw new Error('Charger not found.');

  // If charger has an active session, mark it complete
  if (charger.activeSessionId) {
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, charger.activeSessionId));
    const session = sessionRows[0];

    if (session && !isComplete(session)) {
      await db
        .update(sessions)
        .set({
          status: 'complete',
          active: false,
          overdue: false,
          complete: true,
          endedAt: now,
        })
        .where(eq(sessions.id, session.id));
    }
  }

  // Clear the charger's active session reference
  await db
    .update(chargers)
    .set({ activeSessionId: null })
    .where(eq(chargers.id, chargerId));

  // Return fresh board
  return getBoardData(auth);
}

// ---------------------------------------------------------------------------
// forceEndSession — admin: force-end any active session
// ---------------------------------------------------------------------------

/**
 * Admin action: force-end a session on a charger.
 * Finds the charger, ends its active session, and clears the reference.
 * Returns the updated board.
 *
 * Mirrors forceEnd() from engine.js (operates on chargerId, not sessionId).
 */
export async function forceEndSession(chargerId: string, auth: Auth): Promise<BoardData> {
  if (!auth.email) throw new Error('Not authenticated');

  const configMap = await getConfig();
  assertAdmin(auth.email, configMap);

  const now = new Date();

  // Find the charger
  const chargerRows = await db
    .select()
    .from(chargers)
    .where(eq(chargers.id, chargerId));
  const charger = chargerRows[0];

  if (!charger || !charger.activeSessionId) {
    // No active session — just return the board
    return getBoardData(auth);
  }

  // Find and end the session
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, charger.activeSessionId));
  const session = sessionRows[0];

  if (session && !isComplete(session)) {
    await db
      .update(sessions)
      .set({
        status: 'complete',
        active: false,
        overdue: false,
        complete: true,
        endedAt: now,
      })
      .where(eq(sessions.id, session.id));
  }

  // Clear charger reference
  await db
    .update(chargers)
    .set({ activeSessionId: null })
    .where(eq(chargers.id, chargerId));

  // Return fresh board
  return getBoardData(auth);
}

// ---------------------------------------------------------------------------
// notifyOwner — send notification to the current session owner
// ---------------------------------------------------------------------------

/**
 * Send a "someone is waiting" notification to the owner of the active session
 * on the given charger. Any authenticated user can call this.
 *
 * Mirrors notifyOwner() from engine.js.
 */
export async function notifyOwner(
  chargerId: string,
  auth: Auth,
): Promise<{ success: boolean; message: string; board: BoardData }> {
  if (!auth.email) throw new Error('Not authenticated');

  const configMap = await getConfig();

  // Find charger
  const chargerRows = await db
    .select()
    .from(chargers)
    .where(eq(chargers.id, chargerId));
  const charger = chargerRows[0];

  if (!charger || !charger.activeSessionId) {
    throw new Error('No active session for this charger.');
  }

  // Find the session
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, charger.activeSessionId));
  const session = sessionRows[0];

  if (!session) {
    throw new Error('Session not found.');
  }

  const chargerName = charger.name || `Charger ${charger.id}`;
  const channelMention = getSlackChannelMention(configMap.slack_channel_name);
  const appName = configMap.app_name || 'EV Charging';

  const message = buildMoveCarMessage(appName, chargerName, channelMention);

  const notifyConfig = buildNotifyConfig(configMap);
  const sent = await notifyChannel(message, notifyConfig, session.userId);

  const board = await getBoardData(auth);

  return {
    success: sent,
    message: sent
      ? 'Notification sent to the session owner.'
      : 'Unable to send notification. Please contact the owner directly.',
    board,
  };
}
