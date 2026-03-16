import { db } from '@/lib/db';
import { config } from '@/lib/db/schema';

/**
 * Default configuration values — mirrors APP_DEFAULTS from engine.js.
 * Keys use snake_case to match the config table.
 */
export const APP_DEFAULTS: Record<string, string | number | boolean> = {
  allowed_domain: 'example.com',
  app_name: 'EV Charging',
  slack_channel_name: 'ev-charging',
  slack_channel_url: '',
  slack_webhook_url: '',
  slack_webhook_channel: '',
  slack_bot_token: '',
  admin_emails: '',
  overdue_repeat_minutes: 15,
  session_move_grace_minutes: 10,
  strike_threshold: 2,
  suspension_business_days: 2,
  reservation_advance_days: 0,
  reservation_max_upcoming: 1,
  reservation_max_per_day: 1,
  reservation_gap_minutes: 1,
  reservation_rounding_minutes: 15,
  reservation_checkin_early_minutes: 0,
  reservation_early_start_minutes: 15,
  reservation_late_grace_minutes: 30,
  reservation_open_hour: 5,
  reservation_open_minute: 45,
  walkup_net_new_window_minutes: 10,
  walkup_returning_window_minutes: 10,
  force_end_on_checkin_enabled: true,
  reminder_10_enabled: false,
  reminder_5_enabled: false,
};

/**
 * Fetch the full config map from the database, overlaid on top of defaults.
 * Returns a string-keyed record (values coerced to strings).
 */
export async function getConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(config);
  const configMap: Record<string, string> = {};

  // Lay down defaults first (coerced to string)
  for (const [key, value] of Object.entries(APP_DEFAULTS)) {
    configMap[key] = String(value);
  }

  // Override with DB values
  for (const row of rows) {
    if (row.key && row.value !== null) {
      configMap[row.key] = row.value;
    }
  }

  return configMap;
}

/**
 * Read a single config value with a fallback chain:
 *   provided config -> defaultValue arg -> APP_DEFAULTS -> ''
 */
export function getConfigValue(
  configMap: Record<string, string>,
  key: string,
  defaultValue?: string,
): string {
  return configMap[key] ?? defaultValue ?? String(APP_DEFAULTS[key] ?? '');
}

/**
 * Parse the reservation-related config into typed numeric values.
 * Mirrors getReservationConfig_() in engine.js.
 */
export function getReservationConfig(configMap: Record<string, string>) {
  const int = (key: string, fallback: number) => {
    const v = parseInt(configMap[key], 10);
    return isNaN(v) ? fallback : v;
  };

  // Support "H:MM" format in reservation_open_hour
  let openHour: number;
  let openMinute: number;
  const openHourStr = configMap.reservation_open_hour || '';
  if (openHourStr.includes(':')) {
    const parts = openHourStr.split(':');
    openHour = parseInt(parts[0], 10);
    openMinute = parseInt(parts[1], 10);
  } else {
    openHour = parseInt(openHourStr, 10);
    openMinute = parseInt(configMap.reservation_open_minute, 10);
  }

  const maxPerDay = Math.max(1, int('reservation_max_per_day', 1));

  return {
    advanceDays: int('reservation_advance_days', 0),
    maxUpcoming: int('reservation_max_upcoming', 1),
    maxPerDay,
    gapMinutes: int('reservation_gap_minutes', 1),
    roundingMinutes: int('reservation_rounding_minutes', 15),
    checkinEarlyMinutes: int('reservation_checkin_early_minutes', 0),
    earlyStartMinutes: int('reservation_early_start_minutes', 15),
    lateGraceMinutes: int('reservation_late_grace_minutes', 30),
    netNewWindowMinutes: int('walkup_net_new_window_minutes', 10),
    returningWindowMinutes: int('walkup_returning_window_minutes', 10),
    openHour: isNaN(openHour) ? 5 : openHour,
    openMinute: isNaN(openMinute) ? 45 : openMinute,
  };
}
