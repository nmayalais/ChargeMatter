/**
 * Notification infrastructure — Slack webhook, Slack bot, and email.
 *
 * Ported from engine.js: sendSlackWebhook_(), sendSlackChannelMessage_(),
 * notifyChannel_(), and notifyOwner() notification logic.
 */

// ---------------------------------------------------------------------------
// Slack webhook (incoming webhook URL)
// ---------------------------------------------------------------------------

/**
 * Send a message via a Slack incoming webhook URL.
 * Returns true on success, false on failure (never throws).
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  text: string,
  channel?: string,
): Promise<boolean> {
  if (!webhookUrl) return false;

  try {
    const payload: Record<string, string> = { text };
    if (channel) payload.channel = channel;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch (err) {
    console.error('[SLACK WEBHOOK] Failed to send:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slack bot (chat.postMessage via bot token)
// ---------------------------------------------------------------------------

/**
 * Send a message to a Slack channel using a bot token.
 * Returns true on success, false on failure (never throws).
 */
export async function sendSlackChannelMessage(
  token: string,
  channel: string,
  text: string,
): Promise<boolean> {
  if (!token || !channel) return false;

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });

    if (!response.ok) return false;
    const data = await response.json();
    return !!data.ok;
  } catch (err) {
    console.error('[SLACK BOT] Failed to send channel message:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slack user lookup (for @-mentions)
// ---------------------------------------------------------------------------

/**
 * Look up a Slack user ID by email using a bot token.
 * Returns the user ID string or null if not found.
 */
export async function lookupSlackUserId(
  token: string,
  email: string,
): Promise<string | null> {
  if (!token || !email) return null;

  try {
    const response = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.ok && data.user?.id ? data.user.id : null;
  } catch (err) {
    console.error('[SLACK] User lookup failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Email notification (placeholder — no MailApp in Node.js)
// ---------------------------------------------------------------------------

/**
 * Send an email notification.
 * Currently logs the email; integrate with a service (e.g. Resend) in production.
 */
export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  // TODO: Integrate with email service (Resend, SendGrid, etc.) in production
  console.log(`[EMAIL] To: ${to}, Subject: ${subject}, Body: ${body}`);
  return true;
}

// ---------------------------------------------------------------------------
// Unified channel notification (mirrors notifyChannel_ from engine.js)
// ---------------------------------------------------------------------------

export interface NotifyChannelConfig {
  slackBotToken: string;
  slackWebhookUrl: string;
  slackWebhookChannel: string;
  appName: string;
}

/**
 * Send a notification via the best available Slack method, falling back to email.
 * Mirrors the notifyChannel_() function from engine.js.
 *
 * Priority:
 *   1. Slack bot token + channel (chat.postMessage)
 *   2. Slack incoming webhook
 *   3. Email to the target user (if email provided)
 *
 * Returns true if at least one notification was sent.
 */
export async function notifyChannel(
  text: string,
  config: NotifyChannelConfig,
  targetEmail?: string,
): Promise<boolean> {
  let slackText = text;

  // Try to @-mention the user in Slack if we have a bot token and an email
  if (config.slackBotToken && targetEmail) {
    try {
      const userId = await lookupSlackUserId(config.slackBotToken, targetEmail);
      if (userId) {
        slackText = `<@${userId}> ${text}`;
      }
    } catch {
      // Silently ignore lookup failures
    }
  }

  // Attempt 1: bot token + channel
  let sentSlack = false;
  if (config.slackBotToken && config.slackWebhookChannel) {
    sentSlack = await sendSlackChannelMessage(
      config.slackBotToken,
      config.slackWebhookChannel,
      slackText,
    );
  }

  // Attempt 2: incoming webhook
  if (!sentSlack && config.slackWebhookUrl) {
    sentSlack = await sendSlackWebhook(
      config.slackWebhookUrl,
      slackText,
      config.slackWebhookChannel,
    );
  }

  // Attempt 3: fallback to email
  let sentEmail = false;
  if (!sentSlack && targetEmail) {
    sentEmail = await sendEmailNotification(
      targetEmail,
      `${config.appName} notification`,
      text,
    );
  }

  return sentSlack || sentEmail;
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Build the "someone is waiting for your charger" message.
 * Mirrors the message built in notifyOwner() from engine.js.
 */
export function buildMoveCarMessage(
  appName: string,
  chargerName: string,
  channelMention: string,
): string {
  return (
    `${appName}: Someone is waiting for ${chargerName}. ` +
    `Please move your car and post any delays in ${channelMention}.`
  );
}

/**
 * Format a Slack channel mention from a config channel name.
 * Mirrors getSlackChannelMention_() from engine.js.
 */
export function getSlackChannelMention(slackChannelName: string | undefined): string {
  const raw = String(slackChannelName || '').trim();
  if (!raw) return 'the Slack channel';
  const clean = raw.charAt(0) === '#' ? raw.slice(1) : raw;
  return `#${clean}`;
}
