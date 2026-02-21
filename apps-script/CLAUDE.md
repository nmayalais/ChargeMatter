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

## Mobile UI features (script.html / styles.html)

### My Status Banner (`#my-status-banner`)
`renderMyStatusBanner()` is called inside `renderBoard()` immediately after `renderSuspensionBanner()`. It shows the current user's status at the top of the board with one of three states:

| State | Eyebrow | Inline button |
|---|---|---|
| Active session | "Your session" | "I've moved my car" → `endSession` |
| Reservation in check-in window | "Your reservation" | "Check in" → `checkInReservation` |
| Upcoming reservation (outside window) | "Upcoming reservation" | none |
| No activity | (banner hidden via `is-hidden`) | — |

The banner's `.my-status-banner__countdown[data-session-end]` element is updated by the existing `updateCountdowns()` ticker every second. Reuses `getCurrentUserSession()`, `shouldShowCheckIn()`, `formatTime()`.

### Notice auto-dismiss
`setNotice(message, type)` auto-clears notices after 4 seconds when `type` is `'success'` or `'info'`. Error notices persist until overwritten. The dismiss timer is stored in `state._noticeDismissTimer` and reset on every `setNotice()` call.

### Skeleton loading
`loadBoard()` injects four `.skeleton-card` placeholder elements into `#board` when `state.board === null` (first load only). They are replaced when `renderBoard()` calls `board.innerHTML = ''`.

### Auto-refresh on visibility restore
`handleVisibilityChange()` records `state.hiddenAt` when the tab goes hidden and triggers `loadBoard()` on return if the tab was hidden for more than 60 seconds. Short background trips (< 60 s) only resume the countdown timer.

### Walk-up priority labels
Walk-up rows use user-outcome language instead of internal system vocabulary. The text is derived from `state.board.user.isNetNew` and `state.board.user.isReturning` (both sent by `getBoardData()`):

- **Tier 1 (net-new only)**: `isNetNew` → `"You're eligible · Ends at [time]"` / else → `"Priority window · Opens to all at [time]"`
- **Tier 2 (returning)**: `isReturning` → `"You're eligible · Ends at [time]"` / else → `"Opens to all at [time]"`

### Card hint text
`createCard()` sets `.card-hint` to `"Tap to [action label]"` using the result of `getPrimaryAction()` (already computed in scope). The hint element is hidden via `is-hidden` when there is no primary action.

## Deployment

Uses [clasp](https://github.com/google/clasp). Config is in `.clasp.json` (git-ignored). See `SETUP.md` for full steps.

Secrets (Slack tokens, Spreadsheet IDs) live in **Script Properties**, never in code.

## Sync requirement

Any business logic change here must also be applied to `cli/engine.js`.
