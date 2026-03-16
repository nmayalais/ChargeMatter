# apps-script/CLAUDE.md

Production Google Apps Script code. No build step — files are deployed directly via clasp.

## Files

- **Code.gs** — all server logic: auth, Sheets read/write, session/reservation management, availability computation, reminders, Slack/email notifications. ~2600 lines.
- **index_v3.html** — HTML shell/layout (default UI).
- **script_v3.html** — client-side UI logic (default). Builds on v2 with onboarding tour, help popovers, toast notifications, and "End Session" button label.
- **styles_v3.html** — CSS styles (default UI).
- **index_v2.html** — v2 HTML shell (fallback via `?ui=v2`).
- **script_v2.html** — v2 client-side UI logic (fallback).
- **styles_v2.html** — v2 CSS styles (fallback).
- **appsscript.json** — manifest (timezone: `America/Los_Angeles`, runtime: V8).

## Key entry points in Code.gs

- `doGet()` — serves the web app.
- `getBoardData()` — main data fetch called by the UI on load. Delegates to `buildBoardResponse_()`. Also computes `user.isNetNew` (no sessions or active reservations today) for Option A walk-up priority.
- `sendReminders()` — run by a time-driven trigger (recommended: every 5 min). Handles session reminders, no-show releases, and strikes.
- `startSession()` — enforces Option A net-new priority: during the `walkup_net_new_window_minutes` window after a slot opens, only net-new users may claim it.
- All user actions (start session, reserve, check-in, end session) are called from the frontend via `google.script.run.<functionName>`.

## Key helpers

- `buildBoardResponse_(opts)` — accepts `{auth, now, chargersData, sessionsData, reservationsData, suspensionsData}` and builds the full UI response without reading sheets. All 12 mutating functions use this after writes, re-reading only the sheets they mutated (see staleness rules in `project_perf_refactor.md`).
- `isNetNewUser_(userEmail, sessions, reservations, now)` — returns true if the user has no disqualifying activity today. Early-released sessions/reservations (ended before the halfway point of the reservation window) do not disqualify. Drives Option A walk-up priority.
- `isReturningUser_(userEmail, sessions, reservations, now)` — returns true if the user charged or made a qualifying reservation today. Early-released sessions/reservations do not count.
- `completeReservationForSession_(session, now, reservationsData)` — called on session end; stamps `released_early: true` on the reservation if `now` is before the reservation's halfway point. Optional `reservationsData` avoids re-reading the sheet when data is already loaded.
- `getReservationConfig_(config)` — parses all reservation settings. Supports `"H:MM"` format in `reservation_open_hour` (e.g. `"5:45"` correctly sets 5:45 AM).
- `checkInReservation()` — always delegates session creation to `startSessionForReservation_()` for both early and on-time check-ins. This ensures admin check-ins and reservation-owner check-ins bypass walk-up tier rules correctly. Previously the on-time path called `startSession()` which re-evaluated walk-up rules against the caller's email, breaking admin check-ins.
- `validateReservation_()` — per-day check runs before upcoming-count check so users get the clearer error message first.
- `endSessionInternal_(sessionId, auth, adminOverride, sessionsData, chargersData)` — core session-end logic. Optional data params avoid redundant sheet reads.
- `assertNotSuspended_(auth, suspensionsData)` / `getActiveSuspensionForUser_(email, suspensionsData)` — optional `suspensionsData` param avoids re-reading suspensions sheet.

## Frontend patterns

- `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).<serverFn>(args)` — all server calls use this pattern.
- Mobile-optimized: bottom tab bar switches between Now/Reserve modes; sticky action bar holds primary CTA.
- Admin actions are hidden under overflow menus and gated by `admin_emails` config.

## Mobile UI features (script_v2.html / script_v3.html)

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

- **Tier 1 (net-new only)**: `isNetNew` → `"You're eligible · Ends at [time]"` / else → `"First-time drivers only · Opens wider at [time]"`
- **Tier 2 (net-new OR returning)**: `isNetNew || isReturning` → `"You're eligible · Ends at [time]"` / else → `"Returning drivers priority · Opens to all at [time]"`

Note: Tier 2 checks **both** `isNetNew` and `isReturning` because the backend (`startSession()`) allows either group during this window. A net-new user who didn't claim the spot during Tier 1 remains eligible in Tier 2.

### Card details visibility
Card details (info rows, session/reservation metadata) are always visible — no tap-to-reveal interaction.

### Slot pagination ("Show More")
`getAvailabilitySummary(offset)` accepts an optional `offset` (default `0`) and returns a page of 10 slots starting at that position. The UI tracks pagination in `state.slotsOffset` and `state.slotsAllLoaded`.

- `loadSlots({ loadMore: true })` appends the next page to `state.slotsCache` and advances `state.slotsOffset` by 10.
- `loadSlots()` (no args) resets offset and cache (used on initial load and force-refresh).
- `renderSlotsList()` appends a `.show-more-btn` button at the bottom when `!state.slotsAllLoaded` and the list is non-empty.
- `state.slotsAllLoaded` is set `true` when a page returns fewer than 10 slots.

## UI design system (styles_v2.html / styles_v3.html)

### CSS custom properties (`:root`)
Key tokens to be aware of when making visual changes:

| Token | Value | Notes |
|---|---|---|
| `--color-bg` | `#e8edf3` | Page background — intentionally deeper than surface so white cards lift off |
| `--color-surface` | `#ffffff` | Card/panel background |
| `--color-border` | `#ced3dc` | Default border — strong enough to read on both bg and surface |
| `--color-muted` | `#4b5563` | Secondary text — passes WCAG AA at all used sizes |
| `--color-primary` | `#f15a22` | Orange accent: buttons, selected state, active tab |
| `--bottom-nav-height` | `80px` | Height of the mobile bottom tab bar (excluding safe-area inset). Cascades to `.app` padding-bottom and `.sticky-bar` bottom offset automatically. |

### Status color system
Each status has three tokens: `-bg` (fill), `-text` (foreground), `-border` (pill/chip border). All three are used consistently on status pills, summary chips, notice banners, and legend items. Do not hardcode hex values for status colors — always reference the variables.

| Status | bg token | text token | border token |
|---|---|---|---|
| free | `--status-free-bg` | `--status-free-text` | `--status-free-border` |
| in_use | `--status-in_use-bg` | `--status-in_use-text` | `--status-in_use-border` |
| reserved | `--status-reserved-bg` | `--status-reserved-text` | `--status-reserved-border` |
| overdue | `--status-overdue-bg` | `--status-overdue-text` | `--status-overdue-border` |

### Refresh button (`#refresh-btn`)
Styled via ID selector (overrides `.btn.ghost`): dark charcoal background `#1d2939`, white text. This ensures it remains visible regardless of header background. Do not revert to ghost styling.

### Mobile bottom tab bar (`.mobile-tabs` / `.mobile-tab`)
- Active tab: dark charcoal `#1d2939` background, white text — intentionally distinct from the orange CTA buttons in the main content. Do NOT revert to `--color-primary` (orange); orange is reserved for action buttons only.
- Inactive tab: `#f3f4f6` background, `--color-border` border, `#4b5563` text — always visible
- Bar has `box-shadow: 0 -6px 20px …` projecting upward to visually separate it from scrolling content below
- `--bottom-nav-height` is `64px` (excl. safe area); this cascades to `.app` padding-bottom and `.sticky-bar` bottom offset automatically

## Deployment

Uses [clasp](https://github.com/google/clasp). Config is in `.clasp.json` (git-ignored). See `SETUP.md` for full steps.

**WARNING:** `appsscript.json` MUST contain the `"webapp"` property. Without it, `clasp deploy` creates a Library deployment instead of a Web App, removing the web app URL. Never delete this property.

**Safe deployment workflow:**
- `clasp push` — sync code only (safe, no deployment change)
- `clasp deploy -i <DEPLOYMENT_ID> -d "message"` — update existing deployment (requires `"webapp"` in manifest)
- **Never run `clasp deploy` without `-i`** — this creates a new deployment instead of updating the existing one

Secrets (Slack tokens, Spreadsheet IDs) live in **Script Properties**, never in code.

## Sync requirement

Any business logic change here must also be applied to `cli/engine.js`.
