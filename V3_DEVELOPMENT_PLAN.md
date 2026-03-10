# V3 Development Plan — EV Charger App

**Version:** 3.0
**Date:** 2026-03-09
**Status:** Planning
**Gating:** Admin-only via `?ui=v3` URL param (already spec'd in `UI_V3_PROPOSAL.md`)

---

## Current State

| Asset | Status |
|---|---|
| `index_v3.html` | Exists — copy of v2, references `styles_v3` but still uses `script_v2` |
| `styles_v3.html` | Exists — copy of v2, no v3 changes applied yet |
| `script_v3.html` | Does not exist — needs to be created |
| `UI_V3_PROPOSAL.md` | Complete — 12 visual/animation improvements spec'd |
| `Code.gs` `doGet()` | Needs v3 toggle added |

---

## The Problem

Users report confusion about:
1. **What "Now" vs "Reserve" means** — the two modes aren't self-explanatory
2. **What to do when they arrive** — the check-in flow is unclear (when/how/why)
3. **Walk-up priority tiers** — "First-time drivers only" and "Returning drivers priority" are confusing
4. **What "overdue" means** — users don't understand the consequence or what to do
5. **Where their reservation is** — after reserving, users lose track of their booking
6. **Why they can't start a session** — when blocked by a rule, error messages are technical

---

## Team Structure

### Team 1: UX Clarity & Onboarding
**Goal:** Eliminate user confusion. Make every state and action self-explanatory.

| # | Task | Details |
|---|---|---|
| 1.1 | **First-use guided tour** | Lightweight overlay (3-4 steps) on first visit explaining Now vs Reserve, how check-in works, and what status colors mean. Dismissable, stored in `localStorage`. |
| 1.2 | **Contextual help tooltips** | Add `(?)` icons next to walk-up priority labels, overdue badges, and the reserve section. Tapping shows a 1-sentence explainer in a popover — not a modal. |
| 1.3 | **Rewrite walk-up priority copy** | Replace "First-time drivers only" → "You haven't charged today — you get first pick!" / "Already charged today — opens to you at [time]". Plain language, user-outcome focus. |
| 1.4 | **Rewrite error messages** | Audit all `setNotice('error', ...)` calls. Replace technical messages with action-oriented plain language. E.g., "Charger is in walk-up priority window" → "This charger is reserved for first-time users right now. Try again at 10:15 AM." |
| 1.5 | **Check-in flow coaching** | When a user has an upcoming reservation and opens the app, the My Status Banner should show a step-by-step: "1. Drive to charger → 2. Plug in → 3. Tap Check In below". |
| 1.6 | **"What happens next" confirmations** | After every action (reserve, check-in, start session), show a toast that explains the next step. E.g., after reserving: "You're booked! Come back 15 min before your slot to check in." |
| 1.7 | **Mode tab labels** | Rename "Now" → "Charge Now" and "Reserve" → "Book a Slot" for clarity. |

**Deliverables:** Updated copy in `script_v3.html`, new onboarding overlay in `index_v3.html` + `styles_v3.html`.

---

### Team 2: UI Polish & Animations
**Goal:** Implement the visual improvements from `UI_V3_PROPOSAL.md`.

| # | Task | Priority | Effort |
|---|---|---|---|
| 2.1 | Sticky bar slide-up animation | High | Low |
| 2.2 | Button tap feedback (`:active` scale) | High | Low |
| 2.3 | Toast notifications (replace inline `#notice`) | High | Medium |
| 2.4 | Card expand/collapse animation | High | Medium |
| 2.5 | Pill-style primary CTAs (`border-radius: 9999px`) | Medium | Low |
| 2.6 | Tab switching fade transition | Medium | Low |
| 2.7 | Typography tightening (`letter-spacing: -0.02em`) | Medium | Low |
| 2.8 | Color palette — navy unification (Option A) | Medium | Low |
| 2.9 | Card hover lift (`translateY(-2px)`) | Medium | Low |
| 2.10 | Skeleton → content staggered fade-in | Medium | Medium |
| 2.11 | Summary chip enter animation | Low | Low |
| 2.12 | Card status flash on re-render | Low | Medium |

**Deliverables:** All changes in `styles_v3.html` and `script_v3.html`. Zero business logic changes.

---

### Team 3: Performance & Optimization
**Goal:** Faster load, snappier interactions, less data transferred.

| # | Task | Details |
|---|---|---|
| 3.1 | **Audit `getBoardData()` payload** | Profile the response size. Strip any fields the UI doesn't use. Consider splitting into `getBoardSummary()` (lightweight, for initial render) and `getBoardDetails()` (full, lazy-loaded). |
| 3.2 | **Debounce rapid actions** | Add client-side debounce to `startSession`, `endSession`, `checkIn` buttons (prevent double-tap). Currently only `isLoading` state guards this — add a 500ms debounce on top. |
| 3.3 | **Slots pagination prefetch** | Prefetch the next page of slots while the user is viewing current results. Load page 2 in background after page 1 renders. |
| 3.4 | **Reduce re-renders** | `renderBoard()` currently does `board.innerHTML = ''` and rebuilds everything. Diff against previous state and only update changed cards. |
| 3.5 | **Cache `getBoardData()` in sessionStorage** | On load, show cached board instantly, then refresh in background. Eliminates the skeleton wait on revisits. |
| 3.6 | **Optimize countdown timer** | `updateCountdowns()` runs every second and queries the DOM. Switch to a single `requestAnimationFrame` loop that only updates elements with `[data-session-end]`. |
| 3.7 | **Lazy-load PostHog** | PostHog SDK loads synchronously in `<head>`. Move to async loading after first paint. |

**Deliverables:** Changes split between `Code.gs`/`engine.js` (server) and `script_v3.html` (client). Any engine changes must be synced.

---

### Team 4: Bug Hunting & Edge Cases
**Goal:** Find and fix every broken or inconsistent behavior.

| # | Area | What to test |
|---|---|---|
| 4.1 | **Double-tap race conditions** | Rapidly tap "Start Charging" — does it create two sessions? |
| 4.2 | **Stale board state** | Leave app open for 30 min, then act — does it use stale data? |
| 4.3 | **Timezone edge cases** | Test at 11:45 PM — do reservations for "today" behave correctly near midnight? |
| 4.4 | **Admin check-in for other users** | Admin checks in someone else's reservation — does the session start under the correct user? |
| 4.5 | **Concurrent reservations** | Two users reserve the same slot simultaneously — does one get a clear error? |
| 4.6 | **Session end during grace period** | End session while another reservation's grace period is active — correct behavior? |
| 4.7 | **Mobile Safari quirks** | Test bottom bar safe area, viewport height, scroll bounce, focus zoom on inputs. |
| 4.8 | **Case sensitivity** | Email matching throughout — already partially tested but audit all paths. |
| 4.9 | **Suspension banner persistence** | Suspended user refreshes — does the banner reappear correctly? |
| 4.10 | **Walk-up priority window race** | Timer expires while user is mid-action — does the app handle the transition? |

**Deliverables:** Bug fixes in `engine.js` + `Code.gs` (synced), new test cases in `tests/`, UI fixes in v3 files.

---

### Team 5: QA & Acceptance Testing
**Goal:** Validate all changes before promoting v3.

| # | Task | Details |
|---|---|---|
| 5.1 | **Write E2E test scenarios** | Document manual test scripts for every user flow (new user, returning user, admin, suspended user). |
| 5.2 | **Cross-device testing** | iPhone Safari, Android Chrome, Desktop Chrome/Firefox/Safari. Test at 320px, 375px, 768px, 1440px widths. |
| 5.3 | **Accessibility audit** | Screen reader pass (VoiceOver), keyboard-only navigation, color contrast check (WCAG AA). |
| 5.4 | **Regression testing** | Run full `npm test` suite after every change. Add new tests for v3-specific behavior. |
| 5.5 | **User acceptance testing** | Deploy v3 behind `?ui=v3`. Have 3-5 pilot users test for 1 week. Collect feedback via a shared doc or Slack thread. |
| 5.6 | **PostHog session recordings** | Review v3 session recordings for confusion points, rage clicks, dead ends. |
| 5.7 | **Performance benchmarking** | Measure: time to first render, time to interactive, payload size. Compare v2 vs v3. |

---

## File Ownership

| File | Team(s) |
|---|---|
| `index_v3.html` | Team 1 (onboarding overlay), Team 2 (layout tweaks) |
| `styles_v3.html` | Team 2 (all visual changes), Team 1 (tooltip/tour styles) |
| `script_v3.html` | Team 1 (copy, onboarding JS), Team 2 (animations), Team 3 (perf), Team 4 (bug fixes) |
| `Code.gs` | Team 3 (payload optimization), Team 4 (bug fixes) |
| `cli/engine.js` | Team 3 + Team 4 (must mirror Code.gs changes) |
| `tests/*` | Team 4 (new tests), Team 5 (regression) |

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create `script_v3.html` (copy of `script_v2.html`)
- [ ] Add `?ui=v3` admin gate in `Code.gs` `doGet()`
- [ ] Verify v3 loads and is functionally identical to v2
- [ ] Team 4 begins bug audit (can happen in parallel on v2/engine)

### Phase 2: UX Clarity (Weeks 2-3)
- [ ] Team 1 implements rewritten copy, error messages, mode tab labels
- [ ] Team 1 builds onboarding tour and contextual tooltips
- [ ] Team 1 adds "what happens next" confirmation toasts
- [ ] Team 4 continues bug fixes (landed in both v2 bug fixes + v3)

### Phase 3: Visual Polish (Weeks 3-4)
- [ ] Team 2 implements all 12 items from `UI_V3_PROPOSAL.md`
- [ ] Team 3 implements performance optimizations
- [ ] Integration testing — all teams' changes work together

### Phase 4: QA & Hardening (Week 5)
- [ ] Team 5 runs full QA pass (cross-device, accessibility, regression)
- [ ] Fix all P0/P1 issues found
- [ ] Deploy v3 behind flag for pilot users

### Phase 5: Pilot & Iterate (Weeks 6-7)
- [ ] 3-5 pilot users test v3 in production
- [ ] Collect feedback, review PostHog recordings
- [ ] Iterate on feedback

### Phase 6: Promotion (Week 8)
- [ ] Admin review of final v3
- [ ] Flip `doGet()` default from v2 → v3
- [ ] Monitor for issues, keep v2 as fallback via `?ui=v2`

---

## Open Decisions (Need Your Input)

1. **Color palette** — Option A (keep orange brand, add navy darks) or Option B (shift to blue/white)?
   Recommendation: **Option A** per the V3 proposal.

2. **Fonts** — Keep Fraunces + Sora or switch to a single modern sans (Inter, Geist)?
   Recommendation: **Keep current** — they're distinctive and already loaded.

3. **Onboarding tour** — Full overlay walkthrough or just enhanced contextual hints?
   Recommendation: **Both** — tour on first visit, hints always available.

4. **Performance: board caching** — Worth the complexity of stale-while-revalidate?
   Recommendation: **Yes** — the skeleton loading wait is the #1 perceived speed issue.

5. **Bug fixes scope** — Should Team 4 bug fixes also land in v2 (for immediate benefit) or v3 only?
   Recommendation: **Both** — critical bugs go to v2 immediately, all bugs go to v3.

---

## Success Metrics

| Metric | v2 Baseline | v3 Target |
|---|---|---|
| "How do I...?" Slack questions | Track current volume | Reduce by 50% |
| Time to first meaningful paint | Measure | < 2 seconds |
| Session recording confusion events | Establish baseline | Reduce by 60% |
| Double-tap / rage click rate | Measure | < 1% of sessions |
| User satisfaction (pilot survey) | N/A | > 4/5 average |
