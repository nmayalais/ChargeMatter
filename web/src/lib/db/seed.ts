import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { chargers, config } from './schema';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function seed() {
  console.log('Seeding chargers...');
  await db.insert(chargers).values([
    {
      id: '1',
      name: 'Charger 1',
      maxMinutes: 60,
      slotStarts: '06:00,08:00,10:00,12:00,14:00,16:00',
      activeSessionId: null,
    },
    {
      id: '2',
      name: 'Charger 2',
      maxMinutes: 90,
      slotStarts: '07:00,09:00,11:00,13:00,15:00',
      activeSessionId: null,
    },
  ]).onConflictDoNothing();

  console.log('Seeding config...');
  await db.insert(config).values([
    { key: 'allowed_domain', value: 'example.com' },
    { key: 'app_name', value: 'EV Charging' },
    { key: 'slack_channel_name', value: 'ev-charging' },
    { key: 'slack_channel_url', value: '' },
    { key: 'admin_emails', value: 'user@example.com' },
    { key: 'reservation_open_hour', value: '6' },
    { key: 'reservation_open_minute', value: '0' },
  ]).onConflictDoNothing();

  console.log('Seed complete.');
}

seed()
  .then(() => {
    console.log('Seeded successfully');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
