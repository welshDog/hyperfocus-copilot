# Design: Passive detection of `sprint_ready` / `hyperfocus`

**Status:** Approved for planning
**Date:** 2026-07-25
**Repo:** `hyperfocus-copilot`

## Problem

`SignalDetectionEngine` only has one passive trigger: an idle-timer
(`checkInactivity`) that fires when the user goes *inactive* for 90s+. It
infers `frozen` / `overwhelmed` / `burnt_out` from that idle state. It can
never infer `sprint_ready` or `hyperfocus`, because those describe someone
who's *engaged*, not idle — the opposite precondition. Both labels are
already fully wired downstream (`STATE_MODE_MAP` routes both to
`focus_sprint`, and `hyperfocus` is already one of the six explicit
state-picker buttons) — the gap is purely on the passive-detection side.

## Scope

Both states, as one system:
- **`sprint_ready`** — cold passive detection: infer "seems primed to
  start" from sustained engagement while no mode is active, and offer to
  start a sprint.
- **`hyperfocus`** — in-session escalation: detect that a *running*
  `focus_sprint` has gone unusually long, and surface a break nudge.

**Out of scope (named non-goals):**
- Real typing-cadence / keystroke-interval variance analysis (see
  "Approaches considered" below) — deferred as a documented future hook,
  not built now.
- Cross-tab awareness — matches the app's existing per-tab
  `localStorage` limitation; not a new regression, just not solved here.
- Any change to `MemoryRecallEngine` — its `bestTip({label})` lookup is
  already generic; the two new labels flow through unchanged.
- User-configurable thresholds — hardcoded constants, matching the
  existing style of `INACTIVITY_THRESHOLD_MS` (PRD already flags this
  category as v2 work).

## Approaches considered

**A — Rolling engagement-tick counter (chosen).** Reuse the existing 10s
poll loop and DOM listeners (click/keydown/scroll) already wired in
`SignalDetectionEngine`. Cheap, deterministic, testable without any real
waiting, and matches the simple threshold-rule style the other three
states already use.

**B — True cadence/variance analysis.** Buffer real keydown/scroll
timestamps and compute inter-event mean/stddev to distinguish steady
focused rhythm from erratic distress-clicking. More faithful to the
PRD §3.1 signal table's literal "typing cadence" / "scroll pattern" rows,
but meaningfully more code, harder to test deterministically, and higher
false-positive risk without real usage data to tune against. Rejected for
v1 as over-engineering; left as a documented hook if A proves too noisy
in practice.

## Detection mechanism

One mechanism, two thresholds, built on `SignalDetectionEngine`'s existing
10s tick loop (`checkInactivity`), which currently only evaluates an idle
branch. It grows a parallel **active** branch:

- Each tick: if there was activity (per the existing `lastActivity`
  timestamp, already updated by click/keydown/scroll) in the last 10s,
  increment `activeStreakTicks`; otherwise reset it to 0. This reset
  piggybacks on the exact same idle check already driving
  frozen/overwhelmed/burnt_out — a backgrounded or walked-away-from tab
  kills the streak for free, no new logic required.
- **Distress override:** more than 2 tab-switches (i.e. 3+) within a
  single 10s tick resets the active streak. A single occasional blur
  (checking Slack for 5s) does not reset a long streak — only genuinely
  erratic switching does.

All thresholds below are named constants, same style as the existing
`INACTIVITY_THRESHOLD_MS` — tunable later without a redesign, pinned to
concrete defaults now so the implementation plan isn't guessing:

| Constant | Default | Meaning |
|---|---|---|
| `SPRINT_READY_STREAK_MS` | 4 min (24 ticks) | continuous engagement floor for `sprint_ready` |
| `HYPERFOCUS_STREAK_MS` | 90 min (540 ticks) | continuous engagement floor for the first `hyperfocus` fire |
| `HYPERFOCUS_REFIRE_MS` | 30 min (180 ticks) | minimum gap between repeated `hyperfocus` fires |
| `TAB_SWITCH_DISTRESS_PER_TICK` | 3 | tab-switches within one 10s tick that resets the active streak |

### `sprint_ready`

- Fires when `activeStreakTicks` crosses `SPRINT_READY_STREAK_MS`
  **and** `signalEngine.activeMode` is `null` (no mode currently active
  — i.e. sitting on the picker).
- Confidence: `0.55`.

### `hyperfocus`

- Fires when `activeStreakTicks` crosses `HYPERFOCUS_STREAK_MS`
  **and** `signalEngine.activeMode === 'focus_sprint'`.
- Confidence: `0.6`.
- **Re-fires** every `HYPERFOCUS_REFIRE_MS` of continued streak, so a
  multi-hour session gets repeated gentle nudges, not just one at the
  90-minute mark. Implemented as a delta check, **not modulo**:
  `activeStreakTicks - lastHyperfocusFireTick >= reFireIntervalTicks`.
  A pure modulo (`activeStreakTicks % reFireIntervalTicks === 0`) would
  silently miss the boundary tick if any tick is skipped or delayed (tab
  throttling, sleep/wake) — the delta check survives that.

### Knowing the current mode

`signalEngine` does **not** import `interventionRouter` — that would
break the existing one-directional engine dependency graph (nothing else
does that; `intervention-router.js` importing `task-list.js` is the only
existing cross-engine import, and it's one level, one direction).
Instead, `app.js`'s central `showScreen()` helper is extended to
`showScreen(name, mode)` and becomes the single choke point:

- `showScreen('mode', plan.mode)` → `signalEngine.enterMode(plan.mode)`.
  Called from the existing `mode-changed` listener and from
  `retryWithIntensity` (both already know `plan.mode` at the call site).
- Any other screen name (`'picker'` **or** `'debrief'`) →
  `signalEngine.clearActiveMode()`. Debrief is included deliberately: a
  sprint has ended by the time its debrief shows, so a hyperfocus banner
  must not be able to fire while the user is answering "Did that help?"
  Naming note: this method is `clearActiveMode()`, not `exitToPicker()`
  — the latter name would be dishonest the moment debrief needs the same
  clear-out.

`signalEngine` stays fully decoupled: it's told context via
`enterMode()`/`clearActiveMode()`/`reportExplicit()`, same pattern it
already uses.

## Dispatch & UI

The existing passive-signal listener in `app.js` (`source: 'signal'`,
`confidence >= 0.5` — unchanged gate, both new confidences clear it
comfortably) forks by label:

```
sprint_ready, frozen, overwhelmed, burnt_out  →  showStuckOverlay(s)      // now state-aware
hyperfocus                                    →  showHyperfocusBanner(s) // new, non-blocking
```

This split is forced by the nudge-behavior requirement for hyperfocus
("non-blocking banner, timer keeps running" — chosen specifically to
avoid interrupting real flow), which is structurally a different UI
element from the confirm-yes/no overlay the other four states share. It
is not an inconsistency to resolve; the two states never should have used
the same widget.

### Overlay becomes state-aware

A small `label → { message, primaryLabel }` config map covers `frozen` /
`overwhelmed` / `burnt_out` (existing copy, unchanged) plus the new
`sprint_ready` ("You look locked in — want to start a sprint?" / "Yes,
start it"). Secondary button copy "Not stuck" is renamed to "Not now"
**across all states** — "Not stuck" was already slightly dishonest for
`burnt_out`/`overwhelmed` too (the user might not be stuck, just not
want the intervention right now), so this is a correctness fix riding
along, not scope creep. "Pick different state" is unchanged.

### Hyperfocus banner

A **static element in `index.html`**, sibling to `#stuck-overlay`,
toggled via `hidden` only — never built through `modeContent.innerHTML`
(which *is* wholesale-replaced on mode re-renders). This guarantees the
"wire once at init" listener pattern (mirroring `initDebrief()`, and
specifically avoiding the stacked-listener bug class fixed earlier this
session in `showDebrief`) stays valid regardless of any future refactor
to how `modeContent` renders.

Two buttons:
- **"Keep going"** — dismiss only; updates `lastHyperfocusFireTick` so
  the banner doesn't reopen until the next re-fire interval.
- **"Take a break"** — reuses the existing, already-tested
  `#cancel-sprint` exit path verbatim (`clearInterval(interval)` +
  `showDebrief(plan, false)`), rather than inventing a second, subtly
  different exit route.

The banner never rewrites `plan.detectedState`. It's a UI nudge layered
on top of whatever sprint is already running (which may have started
from `sprint_ready`, an explicit `hyperfocus` pick, or any other label
`STATE_MODE_MAP` routes to `focus_sprint`) — Memory recording on exit
works exactly as it already does, unchanged.

## Testing plan

No real 90-minute waits, in two layers:

1. **Pure-function unit checks, no DOM/timers.** The tick-evaluation
   logic is extracted into a standalone function —
   `classifyEngagement({ activeStreakTicks, activeMode,
   tabSwitchesThisTick, lastHyperfocusFireTick })` — that is pure
   data-in/data-out. A small handwritten Node script (matching this
   repo's "no build step, no framework" philosophy — same style as
   today's ad-hoc Playwright scripts) drives it through boundary values:
   just-under/at/over each threshold, the delta-based re-fire, and the
   distress-reset from tab-switch spam.
2. **Playwright pass for the wiring**, using one test-only method —
   `signalEngine.simulateTicks(n)` — that runs the same per-tick logic
   synchronously instead of waiting on real 10s intervals. Confirms:
   `sprint_ready` overlay copy/routing, hyperfocus banner shows and
   dismisses without stacking listeners across two consecutive fires,
   "Take a break" lands in the real debrief screen, the banner never
   appears outside `activeMode === 'focus_sprint'`, and the streak
   clears on transition to `'debrief'` or `'picker'`.
3. Re-run today's existing regression scripts (frozen tier escalation,
   sprint length ladder, wobbly dip, plain recovery) to confirm the
   `showScreen(name, mode)` signature change didn't break anything.
4. `python scripts/validate_app.py` gate must stay green.
5. `sw.js` `CACHE_NAME` bumped `hfc-v3` → `hfc-v4` — matches this repo's
   established convention of bumping on shipped behavior changes to
   already-listed cached files (`c1e9633`, `420ba5f`), even though the
   gate's own check (`ASSETS list changed ⇒ bump required`) wouldn't
   strictly force it here since no file is being added or removed.

## Files touched (for planning reference)

- `public/js/engines/signal-detection.js` — active-streak tracking,
  `enterMode()`/`clearActiveMode()`, `classifyEngagement()`,
  `simulateTicks()` test hook.
- `public/js/app.js` — `showScreen(name, mode)` signature change and all
  call sites, state-aware overlay config map, `showHyperfocusBanner()` +
  `initHyperfocusBanner()`.
- `public/index.html` — new `#hyperfocus-banner` static element; overlay
  button copy becomes data-driven instead of hardcoded.
- `public/sw.js` — `CACHE_NAME` bump.
