import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing config
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { APP_DEFAULTS, getConfig, getConfigValue, getReservationConfig } from '@/lib/config';
import { db } from '@/lib/db';
// Helper to set up the chained mock: db.select().from(configTable)
function mockDbRows(rows: Array<{ key: string; value: string | null }>) {
  const fromFn = vi.fn().mockResolvedValue(rows);
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromFn });
}

describe('APP_DEFAULTS', () => {
  it('has expected default keys', () => {
    expect(APP_DEFAULTS.app_name).toBe('EV Charging');
    expect(APP_DEFAULTS.strike_threshold).toBe(2);
    expect(APP_DEFAULTS.reservation_late_grace_minutes).toBe(30);
    expect(APP_DEFAULTS.walkup_net_new_window_minutes).toBe(10);
    expect(APP_DEFAULTS.force_end_on_checkin_enabled).toBe(true);
  });
});

describe('getConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when DB is empty', async () => {
    mockDbRows([]);
    const result = await getConfig();
    expect(result.app_name).toBe('EV Charging');
    expect(result.strike_threshold).toBe('2');
  });

  it('overrides defaults with DB values', async () => {
    mockDbRows([
      { key: 'app_name', value: 'Custom App' },
      { key: 'strike_threshold', value: '5' },
    ]);
    const result = await getConfig();
    expect(result.app_name).toBe('Custom App');
    expect(result.strike_threshold).toBe('5');
  });

  it('ignores null DB values', async () => {
    mockDbRows([
      { key: 'app_name', value: null },
    ]);
    const result = await getConfig();
    expect(result.app_name).toBe('EV Charging');
  });
});

describe('getConfigValue', () => {
  it('returns value from config map', () => {
    expect(getConfigValue({ foo: 'bar' }, 'foo')).toBe('bar');
  });
  it('falls back to defaultValue', () => {
    expect(getConfigValue({}, 'foo', 'fallback')).toBe('fallback');
  });
  it('falls back to APP_DEFAULTS', () => {
    expect(getConfigValue({}, 'app_name')).toBe('EV Charging');
  });
  it('returns empty string as last resort', () => {
    expect(getConfigValue({}, 'nonexistent_key')).toBe('');
  });
});

describe('getReservationConfig', () => {
  it('parses numeric config values', () => {
    const configMap: Record<string, string> = {
      reservation_advance_days: '3',
      reservation_max_upcoming: '2',
      reservation_max_per_day: '2',
      reservation_gap_minutes: '5',
      reservation_rounding_minutes: '30',
      reservation_checkin_early_minutes: '10',
      reservation_early_start_minutes: '20',
      reservation_late_grace_minutes: '15',
      walkup_net_new_window_minutes: '5',
      walkup_returning_window_minutes: '5',
      reservation_open_hour: '6',
      reservation_open_minute: '30',
    };
    const result = getReservationConfig(configMap);
    expect(result.advanceDays).toBe(3);
    expect(result.maxUpcoming).toBe(2);
    expect(result.maxPerDay).toBe(2);
    expect(result.gapMinutes).toBe(5);
    expect(result.lateGraceMinutes).toBe(15);
    expect(result.openHour).toBe(6);
    expect(result.openMinute).toBe(30);
  });

  it('supports H:MM format for reservation_open_hour', () => {
    const configMap: Record<string, string> = {
      reservation_open_hour: '5:45',
      reservation_open_minute: '0', // should be ignored
    };
    const result = getReservationConfig(configMap);
    expect(result.openHour).toBe(5);
    expect(result.openMinute).toBe(45);
  });

  it('uses defaults for missing/invalid values', () => {
    const result = getReservationConfig({});
    expect(result.advanceDays).toBe(0);
    expect(result.maxUpcoming).toBe(1);
    expect(result.maxPerDay).toBe(1);
    expect(result.openHour).toBe(5);
    expect(result.openMinute).toBe(45);
  });

  it('enforces maxPerDay >= 1', () => {
    const result = getReservationConfig({ reservation_max_per_day: '0' });
    expect(result.maxPerDay).toBe(1);
  });
});
