# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Web app (Next.js)
cd web && npm run dev      # Start dev server
cd web && npm run build    # Production build
cd web && npm test         # Run vitest tests
cd web && npm run lint     # ESLint check
cd web && npm run lint:fix # ESLint auto-fix
cd web && npm run format   # Prettier format
cd web && npm run format:check  # Prettier check

# Data migration
cd web && npx tsx src/lib/db/seed.ts          # Seed default data
cd web && npx tsx src/lib/db/migrate-data.ts  # Migrate from store.json
cd web && npx drizzle-kit generate            # Generate migration SQL
cd web && npx drizzle-kit migrate             # Apply migration to Neon
```

## Architecture

Next.js web app for managing EV charger reservations, deployed on Vercel with Neon Postgres.

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router, TypeScript) |
| Database | Neon Postgres (Drizzle ORM) |
| Auth | NextAuth.js v5 (Google Provider, JWT) |
| API | Server Actions |
| Cron | Vercel Cron (5-min cycle) |
| Analytics | PostHog |
| Styling | Tailwind CSS |

## Project Structure

```
web/
  src/
    app/           — Next.js pages and API routes
    actions/       — Server Actions (board, sessions, reservations, admin, slots)
    components/    — React components
    lib/           — Business logic, utilities, DB queries
    types/         — TypeScript interfaces
  drizzle/         — Database migrations
archive/           — Previous Apps Script + CLI implementation (preserved for reference)
```

## Data Model

Six Postgres tables (defined in `web/src/lib/db/schema.ts`):

- **chargers** — config + active session reference
- **sessions** — active/completed charging sessions
- **reservations** — bookings with check-in and no-show data
- **config** — key/value settings (grace periods, limits, etc.)
- **strikes** — per-user no-show strike records
- **suspensions** — temporary bans from strike threshold

## Key Files

- `web/src/lib/db/schema.ts` — Drizzle schema (source of truth for data model)
- `web/src/actions/` — All server actions (the API layer)
- `web/src/lib/board.ts` — Board building logic
- `web/src/lib/config.ts` — App configuration with defaults
- `web/src/components/dashboard.tsx` — Main UI orchestrator

## Timezone

All calendar-day logic is locked to **`America/Los_Angeles`** (Pacific Time, auto-adjusting for DST). The constant `APP_TIMEZONE` is exported from `web/src/lib/utils.ts`.

- Never use `new Date(year, month, day, ...)` or bare `.getHours()` / `.getDate()` for business logic — these use the server's local timezone (UTC on Vercel).
- Use `startOfDay`, `dayKey`, `monthKey`, `formatTime`, `formatDate` from `web/src/lib/utils.ts` — they all use Pacific Time internally via `Intl.DateTimeFormat`.
- Tests run with `TZ=UTC` (set in `web/vitest.config.ts`) to simulate Vercel. Write test dates as explicit UTC ISO strings (e.g. `'2026-01-15T16:00:00Z'` for 8:00 AM PST).

## Subtree guidance

Detailed context lives in subdirectory CLAUDE.md files:
- `web/CLAUDE.md` — Next.js app structure, conventions, and patterns
