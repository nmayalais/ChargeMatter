# cli/CLAUDE.md

Local Node.js CLI that mirrors `apps-script/Code.gs` for testing without Google Apps Script.

## Files

- **index.js** — argument parsing and command dispatch.
- **engine.js** — business logic mirror of `Code.gs`. ~2644 lines. This is what tests exercise.
- **store.js** — JSON file store that implements the same Spreadsheet-like interface used in production.
- **runtime.js** — mocks for Apps Script globals (`PropertiesService`, `SpreadsheetApp`, `MailApp`, etc.).
- **seed.js** — populates `data/store.json` with test chargers, sessions, and reservations.

## Commands

```bash
npm run cli -- init                                    # Initialize empty store
npm run cli -- seed                                    # Seed test data
npm run cli -- board                                   # Show charger board
npm run cli -- start-session <chargerId>
npm run cli -- end-session <sessionId>
npm run cli -- reserve <chargerId> <startTimeIso>
npm run cli -- update-reservation <reservationId> <chargerId> <startTimeIso>
npm run cli -- cancel-reservation <reservationId>
npm run cli -- check-in <reservationId>
npm run cli -- next-slot
npm run cli -- availability
npm run cli -- timeline <chargerId> [dateIso]
npm run cli -- calendar [startDateIso] [days]
npm run cli -- send-reminders
```

Flags: `--store <path>` (default: `data/store.json`), `--user <email>` (default: `user@example.com`), `--name <display>`, `--admin`, `--raw`

## Sync requirement

Any business logic change here must also be applied to `apps-script/Code.gs`.
