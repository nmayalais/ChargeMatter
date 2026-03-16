import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendSlackWebhook,
  sendSlackChannelMessage,
  lookupSlackUserId,
  sendEmailNotification,
  notifyChannel,
  buildMoveCarMessage,
  getSlackChannelMention,
  type NotifyChannelConfig,
} from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// sendSlackWebhook
// ---------------------------------------------------------------------------

describe('sendSlackWebhook', () => {
  it('sends a POST to the webhook URL and returns true on success', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const result = await sendSlackWebhook('https://hooks.slack.com/test', 'Hello');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.slack.com/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
  });

  it('includes the channel in the payload when provided', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendSlackWebhook('https://hooks.slack.com/test', 'Hello', '#general');
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.channel).toBe('#general');
  });

  it('returns false when the webhook URL is empty', async () => {
    const result = await sendSlackWebhook('', 'Hello');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns false when fetch returns non-ok', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const result = await sendSlackWebhook('https://hooks.slack.com/test', 'Hello');
    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await sendSlackWebhook('https://hooks.slack.com/test', 'Hello');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sendSlackChannelMessage
// ---------------------------------------------------------------------------

describe('sendSlackChannelMessage', () => {
  it('sends a chat.postMessage and returns true on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const result = await sendSlackChannelMessage('xoxb-token', 'C123', 'Hello');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer xoxb-token',
      },
      body: JSON.stringify({ channel: 'C123', text: 'Hello' }),
    });
  });

  it('returns false when token is empty', async () => {
    const result = await sendSlackChannelMessage('', 'C123', 'Hello');
    expect(result).toBe(false);
  });

  it('returns false when channel is empty', async () => {
    const result = await sendSlackChannelMessage('xoxb-token', '', 'Hello');
    expect(result).toBe(false);
  });

  it('returns false when Slack API returns ok: false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    });
    const result = await sendSlackChannelMessage('xoxb-token', 'C123', 'Hello');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lookupSlackUserId
// ---------------------------------------------------------------------------

describe('lookupSlackUserId', () => {
  it('returns user ID on successful lookup', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, user: { id: 'U123' } }),
    });

    const result = await lookupSlackUserId('xoxb-token', 'user@example.com');
    expect(result).toBe('U123');
  });

  it('returns null when user is not found', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'users_not_found' }),
    });

    const result = await lookupSlackUserId('xoxb-token', 'unknown@example.com');
    expect(result).toBeNull();
  });

  it('returns null when token is empty', async () => {
    const result = await lookupSlackUserId('', 'user@example.com');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sendEmailNotification
// ---------------------------------------------------------------------------

describe('sendEmailNotification', () => {
  it('logs the email and returns true', async () => {
    const result = await sendEmailNotification('user@example.com', 'Test Subject', 'Test Body');
    expect(result).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      '[EMAIL] To: user@example.com, Subject: Test Subject, Body: Test Body',
    );
  });
});

// ---------------------------------------------------------------------------
// notifyChannel
// ---------------------------------------------------------------------------

describe('notifyChannel', () => {
  const baseConfig: NotifyChannelConfig = {
    slackBotToken: '',
    slackWebhookUrl: '',
    slackWebhookChannel: '',
    appName: 'EV Charging',
  };

  it('uses bot token + channel when both are configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const config: NotifyChannelConfig = {
      ...baseConfig,
      slackBotToken: 'xoxb-token',
      slackWebhookChannel: 'C123',
    };

    const result = await notifyChannel('Test message', config);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to webhook when bot token fails', async () => {
    // First call (chat.postMessage) fails, second call (webhook) succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false }),
      })
      .mockResolvedValueOnce({ ok: true });

    const config: NotifyChannelConfig = {
      ...baseConfig,
      slackBotToken: 'xoxb-token',
      slackWebhookUrl: 'https://hooks.slack.com/test',
      slackWebhookChannel: 'C123',
    };

    const result = await notifyChannel('Test message', config);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to email when no Slack methods succeed', async () => {
    const result = await notifyChannel('Test message', baseConfig, 'user@example.com');
    expect(result).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[EMAIL] To: user@example.com'),
    );
  });

  it('returns false when no notification method is available', async () => {
    const result = await notifyChannel('Test message', baseConfig);
    expect(result).toBe(false);
  });

  it('includes @-mention when bot token and email are available', async () => {
    // First call: user lookup
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, user: { id: 'U123' } }),
    });
    // Second call: chat.postMessage
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const config: NotifyChannelConfig = {
      ...baseConfig,
      slackBotToken: 'xoxb-token',
      slackWebhookChannel: 'C123',
    };

    await notifyChannel('Test message', config, 'user@example.com');

    // The second call should have the @-mention in the text
    const postCall = mockFetch.mock.calls[1];
    const body = JSON.parse(postCall[1].body);
    expect(body.text).toBe('<@U123> Test message');
  });
});

// ---------------------------------------------------------------------------
// buildMoveCarMessage
// ---------------------------------------------------------------------------

describe('buildMoveCarMessage', () => {
  it('builds the correct notification message', () => {
    const msg = buildMoveCarMessage('EV Charging', 'Charger A', '#ev-charging');
    expect(msg).toBe(
      'EV Charging: Someone is waiting for Charger A. Please move your car and post any delays in #ev-charging.',
    );
  });
});

// ---------------------------------------------------------------------------
// getSlackChannelMention
// ---------------------------------------------------------------------------

describe('getSlackChannelMention', () => {
  it('formats a channel name with # prefix', () => {
    expect(getSlackChannelMention('ev-charging')).toBe('#ev-charging');
  });

  it('does not double the # prefix', () => {
    expect(getSlackChannelMention('#ev-charging')).toBe('#ev-charging');
  });

  it('returns "the Slack channel" when name is empty', () => {
    expect(getSlackChannelMention('')).toBe('the Slack channel');
    expect(getSlackChannelMention(undefined)).toBe('the Slack channel');
  });
});
