# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test              # Run all Jest tests
npm run policy-check  # Run policy enforcement tests only
npm run cli -- <cmd>  # Run the local CLI (see cli/CLAUDE.md)
```

Run a single test file or pattern:
```bash
npx jest tests/cli.policy.test.js
npx jest --testNamePattern "should suspend user"
```

## Architecture

Google Apps Script web app for managing EV charger reservations. No build step — Apps Script files deploy directly. A mirrored Node.js CLI enables local testing.

**Critical rule:** `cli/engine.js` mirrors `apps-script/Code.gs`. Business logic changes must be applied to both files.

| Concern | Production | Local/Testing |
|---------|-----------|---------------|
| Business logic | `apps-script/Code.gs` | `cli/engine.js` |
| Data store | Google Sheets | `data/store.json` |
| Runtime APIs | Apps Script built-ins | `cli/runtime.js` (mocks) |
| Frontend | `apps-script/script.html` | N/A |

## Data model

Six logical "sheets" (Google Sheets in prod, JSON locally):

- **chargers** — config + active session reference
- **sessions** — active/completed charging sessions
- **reservations** — bookings with check-in and no-show data
- **config** — key/value settings (grace periods, limits, etc.). Notable keys: `reservation_open_hour` supports `"H:MM"` format (e.g. `"5:45"`), `walkup_net_new_window_minutes` controls Option A priority window.
- **strikes** — per-user no-show strike records
- **suspensions** — temporary bans from strike threshold

## Subtree guidance

Detailed context lives in subdirectory CLAUDE.md files, loaded automatically when working in those areas:
- `apps-script/CLAUDE.md` — production Apps Script code and frontend
- `cli/CLAUDE.md` — CLI commands, engine, store, and runtime mocks
- `tests/CLAUDE.md` — test structure and patterns
