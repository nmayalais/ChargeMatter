# UI v3 Proposal — Parkalot-Inspired Redesign

## Background

The current production UI is the `_v2` file set (`index_v2.html`, `styles_v2.html`, `script_v2.html`).
`Code.gs doGet()` already serves these. A new `_v3` set will be built in parallel so v2 remains
stable for all users while v3 is refined.

---

## What Parkalot Does Well

Based on analysis of parkalot.io, the design characteristics that make it feel "seamless":

| Pattern | Parkalot Approach |
|---|---|
| CTA buttons | Fully-rounded pill shape (`border-radius: 9999px`) — flows visually |
| Color palette | Clean navy `#171c37` + crisp white, blue accent `#5469E7` — feels enterprise-polished |
| Typography | Tight letter-spacing (`-0.25px` on headings), strong hierarchy, no decorative serifs |
| Hover micro-interactions | `0.3s ease` transitions on bg/border — every element feels alive |
| Card shadows | Crisp/outlined approach — less blurry soft-glow, more surface definition |
| Status display | Clean pill badges with map-based visual layout context |
| Transitions | Animated mode/view switches — no jarring instant swaps |
| Loading/feedback | Smooth spinner states, success animations, no static inline text |

---

## Current v2 Strengths to Preserve

These are already good — don't throw them out:

- Fraunces serif display font for section titles (warm, distinctive)
- Semantic status color system (free/in_use/reserved/overdue tokens)
- Bottom tab + sticky action bar mobile pattern
- Skeleton card shimmer on first load
- My Status Banner with countdown
- Overdue pulse animation
- Bottom-sheet confirm dialog on mobile

---

## Proposed v3 Changes

### 1. Animated Tab/Mode Switching
**Current:** `display: none` / `display: block` — instant, jarring.
**v3:** Fade + slight upward translate (`opacity 0 → 1`, `translateY(8px) → 0`) on mode change,
with a 200ms ease-out. Makes switching between Now and Reserve feel native-app-quality.

### 2. Card Expand/Collapse Animation
**Current:** `.card.selected .card-details { display: grid }` — details pop in instantly.
**v3:** Use `max-height` transition or `grid-template-rows: 0fr → 1fr` trick to animate the
details section open/closed. Cards also subtly scale up (`scale(1.01)`) on select.

### 3. Pill-Style Primary CTAs
**Current:** `border-radius: var(--radius-md)` = 14px on buttons.
**v3:** Primary action buttons (`primary-action`, `sticky-action`) use `border-radius: 9999px`.
Secondary/ghost buttons keep the 14px radius. This distinction makes CTAs visually dominant.

### 4. Sticky Bar Slide-Up Animation
**Current:** `display: none` → `display: flex` — snaps into view.
**v3:** Position always rendered but `transform: translateY(100%)` when inactive. On activate:
`transform: translateY(0)` with `transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)`
(spring-ish easing). Feels like a native bottom sheet appearing.

### 5. Toast Notifications (Replace Inline Notices)
**Current:** `#notice` is an inline element that shifts layout when it appears.
**v3:** Notices become floating toasts — fixed position, top-center on desktop, top on mobile,
with slide-down-fade-in entry and auto-dismiss with fade-out. Layout never shifts. Much cleaner.

### 6. Color Palette Tightening
**Current:** Warm beige `#f4f1ed` background, orange-dominant gradient.
**v3 option A (brand-consistent):** Keep orange but add a richer dark navy (`#171c37`) as the dark
token to replace the current various dark grays. Unify the dark surface color across refresh btn,
mobile tabs, header actions. Crisper contrast.
**v3 option B (Parkalot-aligned):** Shift to cool white (`#f7f8ff`) background, navy primary text,
blue accent `#5469E7` replacing orange. More enterprise/neutral. Loses brand warmth.

**Recommendation: Option A.** Orange is a good brand differentiator. Tighten the darks and whites.

### 7. Typography Tightening
**Current:** Headings have default/positive letter-spacing.
**v3:** Headings and `.section-title` get `letter-spacing: -0.02em`. Card titles get
`letter-spacing: -0.01em`. Body and labels stay default. Matches the modern "compressed" look
Parkalot uses without changing fonts.

### 8. Card Hover Lift
**Current:** Box-shadow deepens on hover. No transform.
**v3:** On hover (non-touch), cards get `transform: translateY(-2px)` in addition to shadow change,
with `transition: transform 200ms ease, box-shadow 200ms ease`. Subtle but makes the board feel
interactive and 3D.

### 9. Button Tap Feedback
**Current:** `filter: brightness(1.1)` on hover only.
**v3:** Add `transform: scale(0.97)` on `:active` for all `.btn` elements.
`transition: transform 100ms ease`. Instant haptic-like visual feedback on tap.

### 10. Status Change Transition on Cards
**Current:** Cards re-render with new status instantly on board refresh.
**v3:** When a card's status changes between renders, briefly flash the card background
(200ms highlight using the new status color). Achieves this via a CSS `@keyframes flash-in`
added as a class during re-render — no JS changes needed beyond toggling a class.

### 11. Summary Chips Enter Animation
**Current:** Summary chips appear instantly on load.
**v3:** Stagger-fade-in: each `.summary-item` gets `animation-delay: N * 60ms` with a fade-up
entrance. Lightweight, adds polish on first load.

### 12. Skeleton → Real Content Transition
**Current:** Skeleton cards are instantly replaced by real cards.
**v3:** Real cards fade in (`opacity: 0 → 1`) with a staggered delay across the board grid.
The first load feels intentional rather than a content flash.

---

## What We Are NOT Changing

- Business logic in `Code.gs` and `cli/engine.js` — zero changes
- Data model, API surface, or Script Properties
- The `_v2` files — they stay live and unchanged
- Accessibility patterns (ARIA labels, focus-visible rings, min tap targets)
- Status color semantics

---

## Segmentation / Rollout Plan

### Step 1: Create `_v3` file set
New files: `index_v3.html`, `styles_v3.html`, `script_v3.html`
`script_v3.html` is functionally identical to `script_v2.html` (logic copy), only the animations
and event handlers for new transitions are added.

### Step 2: URL param toggle in `Code.gs`
```js
// In doGet(e):
var useV3 = e && e.parameter && e.parameter.ui === 'v3';
var adminEmails = getConfig_().adminEmails || [];
var currentUser = Session.getActiveUser().getEmail();
var isAdmin = adminEmails.indexOf(currentUser) !== -1;

// Only admins can access v3 via ?ui=v3
var templateName = (useV3 && isAdmin) ? 'index_v3' : 'index_v2';
```

This lets admins append `?ui=v3` to the app URL to test the new design without exposing it
to regular users. No Script Properties needed.

### Step 3: Refinement cycle
Test v3 internally. Collect feedback. Iterate on styles_v3.html without touching v2.

### Step 4: Promote to default
When ready, change `Code.gs` to serve `index_v3` by default (or rename files to replace v2).

---

## Implementation Order (Suggested)

Priority order based on user-visible impact vs implementation effort:

| # | Change | Impact | Effort |
|---|---|---|---|
| 1 | Sticky bar slide-up animation | High | Low |
| 2 | Button tap feedback (`:active` scale) | High | Low |
| 3 | Toast notifications | High | Medium |
| 4 | Card expand animation | High | Medium |
| 5 | Pill primary CTAs | Medium | Low |
| 6 | Tab switching fade | Medium | Low |
| 7 | Typography tightening | Medium | Low |
| 8 | Color palette tightening (navy unification) | Medium | Low |
| 9 | Card hover lift | Medium | Low |
| 10 | Skeleton → content fade-in stagger | Medium | Medium |
| 11 | Summary chip enter animation | Low | Low |
| 12 | Card status flash on re-render | Low | Medium |

---

## Open Questions

1. **Option A vs B on colors** — keep warm orange brand or shift to Parkalot's cooler blue?
2. **Font decision** — keep Fraunces/Sora or try a single modern sans (e.g. Inter, Geist)?
3. **Map visualization** — Parkalot's most distinctive feature is an interactive space map.
   Worth adding a simple charger layout SVG to the Now view long-term?
4. **Admin-only v3 flag** — or should v3 be available to all via a beta opt-in banner?
