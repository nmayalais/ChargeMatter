# ChargingMatters Setup

This MVP runs on Google Apps Script + Google Sheets with optional Slack notifications.

## 1) Create the Google Sheet
1. Create a new Google Sheet named `ChargingMatters`.
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
Use the `config` tab (key/value pairs) or Script Properties.

Recommended keys:
- `allowed_domain`: `company.com`
- `admin_emails`: `you@company.com,ops@company.com`
- `overdue_repeat_minutes`: `15`
- `session_move_grace_minutes`: `10`
- `slack_webhook_url`: webhook URL for a channel (optional)
- `slack_webhook_channel`: channel override (optional)
- `slack_bot_token`: Slack bot token for DMs (optional)
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

Script Properties equivalents:
- `ALLOWED_DOMAIN`
- `ADMIN_EMAILS`
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

## 5) Slack setup (optional)
### Incoming webhook (cheapest)
1. Create a Slack app with an Incoming Webhook.
2. Copy the webhook URL into `slack_webhook_url`.

### Slack DM (preferred)
1. Create a Slack app with OAuth scopes:
   - `users:read.email`
   - `conversations:write`
   - `chat:write`
2. Install the app to your workspace.
3. Copy the Bot User OAuth Token into `slack_bot_token`.

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
3. Keep `.clasp.json` out of git (it contains identifiers) and run `clasp push` to sync changes.

## UI modes
The app has two modes:
- **Now** (default): shows charger cards and a single primary action per charger.
- **Reserve**: shows next available slots across chargers, plus My reservations.

On mobile, the mode switch appears as a bottom tab bar and a sticky action bar for the primary action.

## 8) Admin tools
Admins are defined by `admin_emails`. Admins will see:
- **Force end** to stop an active session
- **Reset charger** to clear stuck sessions

Standard users can tap **Notify owner** on in-use or overdue chargers.

## Reservation behavior
- Slots are rounded **up** to 15-minute increments.
- Reservations are currently **same-day only**.
- Check-in opens near the start time, but early start can be allowed via config.
- Early start: if the charger is free, a user can start their reservation up to `reservation_early_start_minutes` early (default 90).
- Prior reservation protection: early starts are blocked while a prior reservation is still within its no-show grace window.
- No-show after `reservation_late_grace_minutes` (default 30) releases the reservation and notifies the user.

## Availability
Reserve mode uses the **Next available** list (earliest slots across chargers) as the primary booking UI.
