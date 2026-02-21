# tests/CLAUDE.md

Jest test suite targeting `cli/engine.js` (business logic) and `apps-script/script.html` (frontend JS via jsdom).

## Test files

- **cli.policy.test.js** — reservation limits (max upcoming, per-day), no-show strikes, suspensions, early-start rules, prior reservation protection, early/late session-release halfway rule.
- **cli.admin.test.js** — admin force-end sessions, reset charger.
- **cli.reservation-session.test.js** — check-in lifecycle, session auto-start on check-in, matching reservations to sessions.
- **ui.test.js** — DOM rendering via jsdom, board data display, action handler behavior, and new mobile-UI features.

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
- `loadScriptIntoDom(options)` is the shared fixture helper in `ui.test.js`. It creates a minimal DOM (including `#my-status-banner`), configures a mock `google.script.run`, evals the script, and exposes `window.__state` for direct state inspection.
- Pass `runMethods: { getBoardData: jest.fn() }` to stub server calls that should not resolve (e.g. skeleton loading tests).
- Set `window.__state.<property>` directly to pre-seed state (e.g. `hiddenAt`) without going through the full UI flow.

## ui.test.js coverage areas

| Group | What is tested |
|---|---|
| Charger cards and slots | Card count, slot row rendering |
| Walk-up timing | `Walk-up ends at`, `Time left` labels; walk-up closed hides start action |
| Slot loading state | Skeleton loading state shows and clears |
| Admin menu | Accessibility attributes, keyboard ArrowDown, Escape to close |
| Primary actions | End session (own / other), notify owner, check-in, release reservation |
| Email case-insensitivity | Session owner and reservation owner matched case-insensitively |
| Admin flag | Board `user.isAdmin` overrides template config; non-admin hides menu |
| Checked-in reservations | End session, end session by reservation ID, case-insensitive owner match |
| **My Status Banner** | Active session (eyebrow, detail, end-session button); check-in window (check-in button); upcoming reservation (no button); no activity (hidden); countdown updated by `updateCountdowns()` |
| **Notice auto-dismiss** | Success and info notices clear after 4 s; error notices persist; new `setNotice()` call resets the dismiss timer |
| **Skeleton loading** | 4 skeleton cards injected on first `loadBoard()` when `state.board === null`; no skeletons on reload |
| **Auto-refresh on visibility restore** | `hiddenAt` recorded on hide; `loadBoard()` triggered after >60 s; not triggered after <60 s |
| **Walk-up priority labels** | Net-new user sees "You're eligible" (Tier 1); non-net-new sees "Priority window"; returning user sees "You're eligible" (Tier 2); non-returning sees "Opens to all at" |
| **Card hint text** | Free charger shows `"Tap to start charging"`; own-session charger shows own-session label; hint hidden when no primary action |
