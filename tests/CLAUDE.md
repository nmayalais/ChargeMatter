# tests/CLAUDE.md

Jest test suite targeting `cli/engine.js`. Tests use an in-memory store (not the filesystem) and CommonJS modules.

## Test files

- **cli.policy.test.js** — reservation limits (max upcoming, per-day), no-show strikes, suspensions, early-start rules, prior reservation protection.
- **cli.admin.test.js** — admin force-end sessions, reset charger.
- **cli.reservation-session.test.js** — check-in lifecycle, session auto-start on check-in, matching reservations to sessions.
- **ui.test.js** — DOM rendering via jsdom, board data display, action handler behavior.

## Running tests

```bash
npm test                                         # All tests
npm run policy-check                             # Policy tests only
npx jest tests/cli.policy.test.js                # Single file
npx jest --testNamePattern "should suspend user" # Single test by name
npx jest --runInBand                             # Serial (used in CI)
```

## Patterns

- Each test file creates a fresh in-memory store via a setup helper — no shared state between tests.
- Business logic under test lives entirely in `cli/engine.js`; `apps-script/Code.gs` is not directly tested.
- jsdom is used only in `ui.test.js` for DOM interaction tests.
