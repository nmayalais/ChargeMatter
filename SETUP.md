# ChargeMatter Setup

This MVP runs on Google Apps Script + Google Sheets with optional Slack notifications.

## 1) Create the Google Sheet
1. Create a new Google Sheet named `ChargeMatter`.
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
- `allowed_domain`: `graymatter-robotics.com`
- `admin_emails`: `you@graymatter-robotics.com,ops@graymatter-robotics.com`
- `overdue_repeat_minutes`: `15`
- `slack_webhook_url`: webhook URL for a channel (optional)
- `slack_webhook_channel`: channel override (optional)
- `slack_bot_token`: Slack bot token for DMs (optional)
- `reservation_advance_days`: `7`
- `reservation_max_upcoming`: `3`
- `reservation_max_per_day`: `2`
- `reservation_gap_minutes`: `1`
- `reservation_rounding_minutes`: `15`
- `reservation_checkin_early_minutes`: `5`
- `reservation_late_grace_minutes`: `10`

Script Properties equivalents:
- `ALLOWED_DOMAIN`
- `ADMIN_EMAILS`
- `OVERDUE_REPEAT_MINUTES`
- `SLACK_WEBHOOK_URL`
- `SLACK_WEBHOOK_CHANNEL`
- `SLACK_BOT_TOKEN`
- `RESERVATION_ADVANCE_DAYS`
- `RESERVATION_MAX_UPCOMING`
- `RESERVATION_MAX_PER_DAY`
- `RESERVATION_GAP_MINUTES`
- `RESERVATION_ROUNDING_MINUTES`
- `RESERVATION_CHECKIN_EARLY_MINUTES`
- `RESERVATION_LATE_GRACE_MINUTES`

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
1. In Apps Script, open **Triggers**.
2. Add a **time-driven** trigger:
   - Function: `sendReminders`
   - Run every minute (or every 5 minutes if you want fewer runs)

## 7) Deploy the web app
1. Click **Deploy** -> **New deployment** -> **Web app**.
2. Set **Execute as**: User accessing the web app.
3. Set **Who has access**: Anyone within your Google Workspace domain.
4. Copy the web app URL and share internally.

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
- Check-in opens 5 minutes before start and auto-starts the session.
- No-show after 10 minutes releases the reservation and notifies the user.

## Availability
Reserve mode uses the **Next available** list (earliest slots across chargers) as the primary booking UI.
