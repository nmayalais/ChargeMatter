# EV Charging Setup

This MVP runs on Google Apps Script + Google Sheets with optional Slack notifications.

## 1) Create the Google Sheet
1. Create a new Google Sheet named `EV Charging`.
2. Copy the Spreadsheet ID from the URL.
3. In the Apps Script project, set Script Properties:
   - `SPREADSHEET_ID` = your sheet ID

## 2) Create the Apps Script project
1. Go to https://script.google.com and create a new project.
2. In the project, create files matching the contents of:
   - `apps-script/Code.gs`
   - `apps-script/index.html`
   - `apps-script/styles.html`
   - `apps-script/script.html`
   - `apps-script/appsscript.json`
3. In Apps Script, open **Project Settings** and paste the `appsscript.json` contents into the manifest.

## 3) Initialize sheets
1. In Apps Script, run `initSheets()` once.
2. In the Google Sheet, populate the `chargers` tab with rows like:
   - `charger_id`: `1`
   - `name`: `Charger 1`
   - `max_minutes`: `120`

This creates these tabs: `chargers`, `sessions`, `config`, `reservations`.

## 4) Configure settings
Use the `config` tab (key/value pairs) for non-secret settings. Use Script Properties for secrets and identifiers.

Recommended keys:
- `allowed_domain`: `example.com`
- `app_name`: `EV Charging`
- `slack_channel_name`: `ev-charging`
- `slack_channel_url`: `https://your-workspace.slack.com/archives/CHANNEL_ID`
- `admin_emails`: `you@example.com,ops@example.com`
- `ui_version`: `v1` or `v2`
- `ui_v2_allowlist`: comma-separated emails for v2 access
- `overdue_repeat_minutes`: `15`
- `session_move_grace_minutes`: `10`
- `reservation_advance_days`: `7`
- `reservation_max_upcoming`: `3`
- `reservation_max_per_day`: `1`
- `reservation_gap_minutes`: `1`
- `reservation_rounding_minutes`: `15`
- `reservation_checkin_early_minutes`: `5`
- `reservation_early_start_minutes`: `90`
- `reservation_late_grace_minutes`: `30`
- `reservation_open_hour`: `6`
- `reservation_open_minute`: `0`
- `walkup_net_new_window_minutes`: `10`
- `walkup_returning_window_minutes`: `10`

Script Properties equivalents:
- `ALLOWED_DOMAIN`
- `APP_NAME`
- `SLACK_CHANNEL_NAME`
- `SLACK_CHANNEL_URL`
- `ADMIN_EMAILS`
- `UI_VERSION`
- `UI_V2_ALLOWLIST`
- `OVERDUE_REPEAT_MINUTES`
- `SESSION_MOVE_GRACE_MINUTES`
- `SLACK_WEBHOOK_URL`
- `SLACK_WEBHOOK_CHANNEL`
- `SLACK_BOT_TOKEN`
- `RESERVATION_ADVANCE_DAYS`
- `RESERVATION_MAX_UPCOMING`
- `RESERVATION_MAX_PER_DAY`
- `RESERVATION_GAP_MINUTES`
- `RESERVATION_ROUNDING_MINUTES`
- `RESERVATION_CHECKIN_EARLY_MINUTES`
- `RESERVATION_EARLY_START_MINUTES`
- `RESERVATION_LATE_GRACE_MINUTES`
- `RESERVATION_OPEN_HOUR`
- `RESERVATION_OPEN_MINUTE`
- `WALKUP_NET_NEW_WINDOW_MINUTES`
- `WALKUP_RETURNING_WINDOW_MINUTES`
- `DM_REMINDERS_ENABLED` (optional, default `true`)
- `CHANNEL_ESCALATIONS_ENABLED` (optional, default `true`)
- `NOTIFICATION_PUBLIC_ESCALATION_TIER` (optional, default `grace`)

## 5) Slack setup (optional)
### Incoming webhook (cheapest)
1. Create a Slack app with an Incoming Webhook.
2. Use one active webhook for the production channel `#chargingmatters`.
3. Store the webhook URL in Apps Script Script Properties as `SLACK_WEBHOOK_URL`.
4. Delete old duplicate webhooks only after the new Script Property is saved and the app has been verified.
5. Do not store webhook URLs in the `config` sheet.

### Slack DM (preferred)
1. Create a Slack app with OAuth scopes:
   - `users:read.email`
   - `conversations:write`
   - `chat:write`
2. Install the app to your workspace.
3. Store the Bot User OAuth Token in Script Properties as `SLACK_BOT_TOKEN`.
4. Do not store bot tokens in the `config` sheet.

After Script Properties are saved and production QA passes, remove any legacy secret values from the Sheet `config` tab:
- `slack_webhook_url`
- `slack_bot_token`

Keep non-secret Slack values in the Sheet if they are useful:
- `slack_channel_name`
- `slack_channel_url`
- `slack_webhook_channel`

Routine reminders use Slack DM first, then email fallback. They do not fall back to the public channel. Public channel posts remain for operational escalations such as grace/overdue, no-show release, and force-end-on-checkin.

## 6) Add reminder trigger
Option A (recommended): run the helper function once.
1. In Apps Script, run `installReminderTrigger()` to install a 5-minute trigger.
2. (Optional) Run `installReminderTriggerEveryMinute()` if you prefer 1-minute cadence.

Option B (manual):
1. In Apps Script, open **Triggers**.
2. Add a **time-driven** trigger:
   - Function: `sendReminders`
   - Run every 5 minutes (recommended) or every minute (more immediate)

## 7) Deploy the web app
1. Click **Deploy** -> **New deployment** -> **Web app**.
2. Set **Execute as**: User accessing the web app.
3. Set **Who has access**: Anyone within your Google Workspace domain.
4. Copy the web app URL and share internally.

## 7.5) Optional: use clasp for faster updates
1. Install clasp and log in (`npm i -g @google/clasp`, `clasp login`).
2. Create a local `.clasp.json` with your Apps Script `scriptId` and `rootDir: "apps-script"`.
3. Keep `.clasp.json` out of git (it contains identifiers).
4. Run `clasp status` before any push.
5. Use `clasp push --force` when manifest changes are intentional, such as OAuth scope updates.
6. Use a separate explicit approval for `clasp deploy`; pushing source does not update the production deployment URL.

## UI modes
The app has two modes:
- **Now** (default): shows charger cards and a single primary action per charger.
- **Reserve**: shows next available slots across chargers, plus My reservations.

UI versioning (feature flags):
1. URL override: `?v=2` loads v2.
2. Allowlist: `ui_v2_allowlist` contains the user email.
3. Global default: `ui_version` is `v2`.
4. Fallback: v1.

On mobile, the mode switch appears as a bottom tab bar and a sticky action bar for the primary action.

## 8) Admin tools
Admins are defined by `admin_emails`. Admins will see:
- **Force end** to stop an active session
- **Reset charger** to clear stuck sessions
- `getOperationalDiagnostics()` in Apps Script for row counts, trigger names, Slack secret source status, and latest board-load timing. It returns status only, not secret values.

Standard users can tap **Notify owner** on in-use or overdue chargers.

## Reservation session handling
- When a user ends a charging session, the matching checked-in reservation is automatically marked `complete`.
- If a checked-in reservation has no matching active session, the UI offers to clear the checked-in reservation.

## Reservation behavior
- Slots are rounded **up** to 15-minute increments.
- Reservations are currently **same-day only**.
- Check-in opens near the start time, but early start can be allowed via config.
- Early start: if the charger is free, a user can start their reservation up to `reservation_early_start_minutes` early (default 90).
- Prior reservation protection: early starts are blocked while a prior reservation is still within its no-show grace window.
- No-show after `reservation_late_grace_minutes` (default 30) releases the reservation and notifies the user.

## Availability
Reserve mode uses the **Next available** list (earliest slots across chargers) as the primary booking UI.
