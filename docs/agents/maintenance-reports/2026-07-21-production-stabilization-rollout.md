# ChargeMatter Production Stabilization Rollout

Date: 2026-07-21
Production deployment: `AKfycbzG62vpV-i1M839wr_A_lzbHbJ3F1orTXMWbLxI_UeTbKnufeJ3RG6_X4nPU4XnB98`
Production version after rollout: `104`
GitHub PR: `https://github.com/nmayalais/ChargeMatter/pull/4`

## Summary

Production was updated to improve board load performance, move Slack secrets to Script Properties, and add diagnostics for future maintenance. The user completed Apps Script reauthorization, production QA, Slack webhook cleanup, and removal of old Sheet config secrets.

## Changes Deployed

- `getBoardData()` now uses read-only, bounded board reads for operational sessions, reservations, and suspensions.
- Board-load timing is logged and cached for admin diagnostics.
- Added `getOperationalDiagnostics()` for row counts, trigger names, Slack secret source status, and latest board timing. It does not return secret values.
- Slack webhook URL and bot token now prefer Apps Script Script Properties over Sheet config values.
- Apps Script OAuth scopes are explicit in the manifest.
- Docs now state that Slack secrets must not live in the Sheet `config` tab.

## Manual Actions Completed

- Apps Script authorization was refreshed by running `getBoardData`; execution completed successfully.
- Production app QA passed after deployment.
- New Slack incoming webhook was saved as `SLACK_WEBHOOK_URL` in Script Properties.
- Slack bot token was saved as `SLACK_BOT_TOKEN` in Script Properties.
- Duplicate Slack webhooks were removed, leaving one active webhook for `#chargingmatters`.
- Old Sheet `config` secret values were removed:
  - `slack_webhook_url`
  - `slack_bot_token`

## Validation

- GitHub Actions for PR #4 passed.
- Local legacy Jest tests passed.
- Local web tests passed.
- Local lint passed.
- Apps Script syntax checks passed against temporary `.js` copies.
- `clasp status` passed before and after deployment.
- `clasp push --force` completed successfully.
- Production deployment updated successfully to version `104`.

## Follow-Up Monitoring

- Confirm routine reminders arrive by Slack DM or email fallback.
- Confirm public channel escalation still works for operational escalation events.
- Review `getOperationalDiagnostics()` if users report slow loads again.
- Keep exactly one Slack webhook for `#chargingmatters`.
- Keep Slack secrets in Script Properties only.

## Guardrails

- Do not run `clasp push --force` without explicit approval.
- Do not run `clasp deploy` without separate explicit approval.
- Do not modify Sheet rows, triggers, or Script Properties without naming the exact target and getting approval.
- Do not remove historical reservation rows unless audit/history removal is explicitly approved.
