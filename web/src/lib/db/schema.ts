import { pgTable, text, integer, boolean, timestamp, uuid, index } from 'drizzle-orm/pg-core';

export const chargers = pgTable('chargers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  maxMinutes: integer('max_minutes').notNull(),
  slotStarts: text('slot_starts').notNull(),
  activeSessionId: text('active_session_id'),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chargerId: text('charger_id')
      .notNull()
      .references(() => chargers.id),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull().default(''),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    active: boolean('active').notNull().default(true),
    overdue: boolean('overdue').notNull().default(false),
    complete: boolean('complete').notNull().default(false),
    reminder10Sent: boolean('reminder_10_sent').notNull().default(false),
    reminder5Sent: boolean('reminder_5_sent').notNull().default(false),
    reminder0Sent: boolean('reminder_0_sent').notNull().default(false),
    overdueLastSentAt: timestamp('overdue_last_sent_at', { withTimezone: true }),
    graceNotifiedAt: timestamp('grace_notified_at', { withTimezone: true }),
    lateStrikeAt: timestamp('late_strike_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [index('idx_sessions_user_id').on(table.userId), index('idx_sessions_charger_id').on(table.chargerId)]
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chargerId: text('charger_id')
      .notNull()
      .references(() => chargers.id),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull().default(''),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    noShowAt: timestamp('no_show_at', { withTimezone: true }),
    noShowStrikeAt: timestamp('no_show_strike_at', { withTimezone: true }),
    reminder5BeforeSent: boolean('reminder_5_before_sent').notNull().default(false),
    reminder5AfterSent: boolean('reminder_5_after_sent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    releasedEarly: boolean('released_early').notNull().default(false),
  },
  (table) => [
    index('idx_reservations_user_id').on(table.userId),
    index('idx_reservations_charger_id').on(table.chargerId),
    index('idx_reservations_start_time').on(table.startTime),
  ]
);

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const strikes = pgTable(
  'strikes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull().default(''),
    type: text('type').notNull(),
    sourceType: text('source_type').notNull().default(''),
    sourceId: text('source_id').notNull().default(''),
    reason: text('reason').notNull().default(''),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    monthKey: text('month_key').notNull(),
  },
  (table) => [index('idx_strikes_user_month').on(table.userId, table.monthKey)]
);

export const suspensions = pgTable(
  'suspensions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull().default(''),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull().default(''),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_suspensions_user_active').on(table.userId)]
);

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey(),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
