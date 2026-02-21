# apps-script/CLAUDE.md

Production Google Apps Script code. No build step — files are deployed directly via clasp.

## Files

- **Code.gs** — all server logic: auth, Sheets read/write, session/reservation management, availability computation, reminders, Slack/email notifications. ~2600 lines.
- **index.html** — HTML shell/layout.
- **script.html** — client-side UI logic (vanilla JS). Two modes: **Now** (immediate charge) and **Reserve** (booking).
- **styles.html** — CSS styles.
- **appsscript.json** — manifest (timezone: `America/Los_Angeles`, runtime: V8).

## Key entry points in Code.gs

- `doGet()` — serves the web app.
- `getBoardData()` — main data fetch called by the UI on load. Also computes `user.isNetNew` (no sessions or active reservations today) for Option A walk-up priority.
- `sendReminders()` — run by a time-driven trigger (recommended: every 5 min). Handles session reminders, no-show releases, and strikes.
- `startSession()` — enforces Option A net-new priority: during the `walkup_net_new_window_minutes` window after a slot opens, only net-new users may claim it.
- All user actions (start session, reserve, check-in, end session) are called from the frontend via `google.script.run.<functionName>`.

## Key helpers

- `isNetNewUser_(userEmail, sessions, reservations, now)` — returns true if the user has no disqualifying activity today. Early-released sessions/reservations (ended before the halfway point of the reservation window) do not disqualify. Drives Option A walk-up priority.
- `isReturningUser_(userEmail, sessions, reservations, now)` — returns true if the user charged or made a qualifying reservation today. Early-released sessions/reservations do not count.
- `completeReservationForSession_(session, now)` — called on session end; stamps `released_early: true` on the reservation if `now` is before the reservation's halfway point (using the original planned `end_time` before it is overwritten).
- `getReservationConfig_(config)` — parses all reservation settings. Supports `"H:MM"` format in `reservation_open_hour` (e.g. `"5:45"` correctly sets 5:45 AM).
- `checkInReservation()` — early-check-in window uses `earlyStartMinutes` only (not the old `Math.max` conflation with `checkinEarlyMinutes`).
- `validateReservation_()` — per-day check runs before upcoming-count check so users get the clearer error message first.

## Frontend patterns

- `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).<serverFn>(args)` — all server calls use this pattern.
- Mobile-optimized: bottom tab bar switches between Now/Reserve modes; sticky action bar holds primary CTA.
- Admin actions are hidden under overflow menus and gated by `admin_emails` config.

## Deployment

Uses [clasp](https://github.com/google/clasp). Config is in `.clasp.json` (git-ignored). See `SETUP.md` for full steps.

Secrets (Slack tokens, Spreadsheet IDs) live in **Script Properties**, never in code.

## Sync requirement

Any business logic change here must also be applied to `cli/engine.js`.
