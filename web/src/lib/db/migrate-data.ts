/**
 * Data migration script: JSON store format (Google Sheets mirror) -> Neon Postgres
 *
 * Usage:
 *   npx tsx src/lib/db/migrate-data.ts [path-to-store.json]
 *
 * Default path: ../../data/store.json (relative to web/)
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SheetData {
  headers: string[];
  rows: (string | number | boolean | null)[][];
}

interface StoreJson {
  properties?: Record<string, string>;
  sheets: {
    chargers: SheetData;
    sessions: SheetData;
    reservations: SheetData;
    config: SheetData;
    strikes: SheetData;
    suspensions: SheetData;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert header+row arrays into an array of keyed objects */
function toObjects(sheet: SheetData): Record<string, string>[] {
  const { headers, rows } = sheet;
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] == null ? '' : String(row[i]);
    });
    return obj;
  });
}

function toBool(val: string | undefined): boolean {
  if (!val) return false;
  return val.toLowerCase() === 'true';
}

function toDate(val: string | undefined): Date | null {
  if (!val || val.trim() === '') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toIntOrNull(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function migrate() {
  const dataPath =
    process.argv[2] ||
    path.resolve(__dirname, '../../../../data/store.json');

  if (!fs.existsSync(dataPath)) {
    console.error(`File not found: ${dataPath}`);
    process.exit(1);
  }

  console.log(`Reading data from: ${dataPath}`);
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const store: StoreJson = JSON.parse(raw);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Create web/.env.local with your Neon connection string.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  // -----------------------------------------------------------------------
  // 1. Config (no dependencies)
  // -----------------------------------------------------------------------
  const configRows = toObjects(store.sheets.config);
  if (configRows.length > 0) {
    console.log(`Inserting ${configRows.length} config rows...`);
    await db
      .insert(schema.config)
      .values(
        configRows.map((r) => ({
          key: r.key,
          value: r.value || null,
        })),
      )
      .onConflictDoNothing();
  }
  console.log(`  config: ${configRows.length} rows`);

  // -----------------------------------------------------------------------
  // 2. Chargers (no dependencies)
  // -----------------------------------------------------------------------
  const chargerRows = toObjects(store.sheets.chargers);
  if (chargerRows.length > 0) {
    console.log(`Inserting ${chargerRows.length} charger rows...`);
    await db
      .insert(schema.chargers)
      .values(
        chargerRows.map((r) => ({
          id: r.charger_id,
          name: r.name,
          maxMinutes: toIntOrNull(r.max_minutes) ?? 60,
          slotStarts: r.slot_starts,
          activeSessionId: r.active_session_id || null,
        })),
      )
      .onConflictDoNothing();
  }
  console.log(`  chargers: ${chargerRows.length} rows`);

  // -----------------------------------------------------------------------
  // 3. Sessions (depends on chargers)
  // -----------------------------------------------------------------------
  const sessionRows = toObjects(store.sheets.sessions);
  if (sessionRows.length > 0) {
    console.log(`Inserting ${sessionRows.length} session rows...`);
    for (const r of sessionRows) {
      const startTime = toDate(r.start_time);
      const endTime = toDate(r.end_time);
      if (!startTime || !endTime) {
        console.warn(`  Skipping session ${r.session_id}: missing start/end time`);
        continue;
      }
      await db
        .insert(schema.sessions)
        .values({
          id: r.session_id,
          chargerId: r.charger_id,
          userId: r.user_id,
          userName: r.user_name || '',
          startTime,
          endTime,
          status: r.status || 'active',
          active: toBool(r.active),
          overdue: toBool(r.overdue),
          complete: toBool(r.complete),
          reminder10Sent: toBool(r.reminder_10_sent),
          reminder5Sent: toBool(r.reminder_5_sent),
          reminder0Sent: toBool(r.reminder_0_sent),
          overdueLastSentAt: toDate(r.overdue_last_sent_at),
          graceNotifiedAt: toDate(r.grace_notified_at),
          lateStrikeAt: toDate(r.late_strike_at),
          endedAt: toDate(r.ended_at),
        })
        .onConflictDoNothing();
    }
  }
  console.log(`  sessions: ${sessionRows.length} rows`);

  // -----------------------------------------------------------------------
  // 4. Reservations (depends on chargers)
  // -----------------------------------------------------------------------
  const reservationRows = toObjects(store.sheets.reservations);
  if (reservationRows.length > 0) {
    console.log(`Inserting ${reservationRows.length} reservation rows...`);
    for (const r of reservationRows) {
      const startTime = toDate(r.start_time);
      const endTime = toDate(r.end_time);
      if (!startTime || !endTime) {
        console.warn(`  Skipping reservation ${r.reservation_id}: missing start/end time`);
        continue;
      }
      await db
        .insert(schema.reservations)
        .values({
          id: r.reservation_id,
          chargerId: r.charger_id,
          userId: r.user_id,
          userName: r.user_name || '',
          startTime,
          endTime,
          status: r.status || 'active',
          checkedInAt: toDate(r.checked_in_at),
          noShowAt: toDate(r.no_show_at),
          noShowStrikeAt: toDate(r.no_show_strike_at),
          reminder5BeforeSent: toBool(r.reminder_5_before_sent),
          reminder5AfterSent: toBool(r.reminder_5_after_sent),
          createdAt: toDate(r.created_at) ?? new Date(),
          updatedAt: toDate(r.updated_at) ?? new Date(),
          canceledAt: toDate(r.canceled_at),
          releasedEarly: toBool(r.released_early),
        })
        .onConflictDoNothing();
    }
  }
  console.log(`  reservations: ${reservationRows.length} rows`);

  // -----------------------------------------------------------------------
  // 5. Strikes (no dependencies)
  // -----------------------------------------------------------------------
  const strikeRows = toObjects(store.sheets.strikes);
  if (strikeRows.length > 0) {
    console.log(`Inserting ${strikeRows.length} strike rows...`);
    for (const r of strikeRows) {
      const occurredAt = toDate(r.occurred_at);
      if (!occurredAt) {
        console.warn(`  Skipping strike ${r.strike_id}: missing occurred_at`);
        continue;
      }
      await db
        .insert(schema.strikes)
        .values({
          id: r.strike_id,
          userId: r.user_id,
          userName: r.user_name || '',
          type: r.type,
          sourceType: r.source_type || '',
          sourceId: r.source_id || '',
          reason: r.reason || '',
          occurredAt,
          monthKey: r.month_key,
        })
        .onConflictDoNothing();
    }
  }
  console.log(`  strikes: ${strikeRows.length} rows`);

  // -----------------------------------------------------------------------
  // 6. Suspensions (no dependencies)
  // -----------------------------------------------------------------------
  const suspensionRows = toObjects(store.sheets.suspensions);
  if (suspensionRows.length > 0) {
    console.log(`Inserting ${suspensionRows.length} suspension rows...`);
    for (const r of suspensionRows) {
      const startAt = toDate(r.start_at);
      const endAt = toDate(r.end_at);
      if (!startAt || !endAt) {
        console.warn(`  Skipping suspension ${r.suspension_id}: missing start/end`);
        continue;
      }
      await db
        .insert(schema.suspensions)
        .values({
          id: r.suspension_id,
          userId: r.user_id,
          userName: r.user_name || '',
          startAt,
          endAt,
          reason: r.reason || '',
          active: toBool(r.active),
          createdAt: toDate(r.created_at) ?? new Date(),
        })
        .onConflictDoNothing();
    }
  }
  console.log(`  suspensions: ${suspensionRows.length} rows`);

  console.log('\nMigration complete.');
}

migrate()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  });
