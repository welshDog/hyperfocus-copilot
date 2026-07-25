# Sprint-ready / hyperfocus signal detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SignalDetectionEngine` passively detect `sprint_ready` (sustained engagement while idle on the picker) and `hyperfocus` (a running `focus_sprint` gone unusually long), and wire both into the UI — a state-aware confirm overlay for `sprint_ready`, a new non-blocking banner for `hyperfocus`.

**Architecture:** One new active-streak mechanism on `SignalDetectionEngine`'s existing 10s poll loop, decision logic split into a pure `classifyEngagement()` function (unit-testable with synthetic inputs) plus stateful edge-triggering in the engine. `app.js`'s `showScreen()` becomes the single choke point that tells the engine which mode is active. Dispatch forks by label: `sprint_ready` reuses the existing confirm overlay (now state-aware copy); `hyperfocus` gets a new static, non-modal banner.

**Tech Stack:** Vanilla JS (ES modules), no build step, no new dependencies. Tests: plain Node scripts (`node:assert/strict`, stdlib only) for pure/stateful engine logic; ad-hoc Playwright scripts (scratch directory, not committed — matches this repo's existing convention) for DOM wiring.

**Spec:** `docs/superpowers/specs/2026-07-25-sprint-ready-hyperfocus-signal-detection-design.md` (approved 2026-07-25).

## Global Constraints

- No new npm dependencies, no build step — this repo is vanilla JS / ES modules only (README §"Why no React / build step?").
- Threshold constants, exact values (from the spec's table): `SPRINT_READY_STREAK_MS` = 4 min (24 ticks), `HYPERFOCUS_STREAK_MS` = 90 min (540 ticks), `HYPERFOCUS_REFIRE_MS` = 30 min (180 ticks), `TAB_SWITCH_DISTRESS_PER_TICK` = 3, tick period = 10s (existing).
- `signalEngine` must never import `interventionRouter` — the engine dependency graph stays one-directional (spec's "Knowing the current mode" section).
- Hyperfocus re-fire uses the delta check `activeStreakTicks - lastHyperfocusFireTick >= HYPERFOCUS_REFIRE_TICKS`, **never** a modulo — a modulo silently misses the boundary on a skipped/delayed tick.
- `sw.js` `CACHE_NAME` must be bumped `hfc-v3` → `hfc-v4` before the final push (matches this repo's convention of bumping on shipped behavior changes, commits `c1e9633`/`420ba5f`).
- `python scripts/validate_app.py` must pass before every push (the pre-push hook already enforces this — don't bypass with `--no-verify`).
- Playwright scratch scripts live outside the repo (a scratch/temp directory) and are **not committed** — matches this repo's existing verification convention (today's `test_retry.js`/`test_recovery.js`/`test_wobbly.js` were scratch-only). Only the two new Node test files under `scripts/` are committed.
- Commit inside `hyperfocus-copilot` only, never at the `HperCore` workspace root. Commit prefixes: `feat:`/`fix:`/`docs:`/`chore:`.

---

## Task 1: `classifyEngagement` pure decision function

**Files:**
- Modify: `public/js/engines/signal-detection.js` (additive only — no existing code changes yet)
- Create: `scripts/test_signal_classify.mjs`

**Interfaces:**
- Produces: `export function classifyEngagement({ activeStreakTicks, activeMode, tabSwitchesThisTick, lastHyperfocusFireTick }) => { label: 'sprint_ready'|'hyperfocus', confidence: number } | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/test_signal_classify.mjs`:

```js
// scripts/test_signal_classify.mjs
// Pure-function boundary tests for classifyEngagement. No DOM, no timers,
// no framework — matches this repo's zero-build-step philosophy.
// Run with: node scripts/test_signal_classify.mjs
import assert from 'node:assert/strict';
import { classifyEngagement } from '../public/js/engines/signal-detection.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log('classifyEngagement:');

test('below sprint_ready threshold on the picker returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 23, activeMode: null, tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('at sprint_ready threshold on the picker fires sprint_ready', () => {
  const r = classifyEngagement({ activeStreakTicks: 24, activeMode: null, tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.deepEqual(r, { label: 'sprint_ready', confidence: 0.55 });
});

test('sprint_ready threshold crossed but a mode is active returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 100, activeMode: 'freeze_rescue', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('below hyperfocus threshold in a sprint returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 539, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('at hyperfocus threshold in a sprint fires hyperfocus', () => {
  const r = classifyEngagement({ activeStreakTicks: 540, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.deepEqual(r, { label: 'hyperfocus', confidence: 0.6 });
});

test('hyperfocus threshold crossed but not in a sprint returns null', () => {
  // activeMode: 'freeze_rescue', not null — null would also satisfy
  // sprint_ready's own gate (activeMode === null && ticks >= 24), which
  // wouldn't isolate what this test claims to check. Use a mode that
  // satisfies neither gate, same pattern as the test above.
  const r = classifyEngagement({ activeStreakTicks: 540, activeMode: 'freeze_rescue', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('re-fire before the 30min delta returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 719, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 540 });
  assert.equal(r, null); // 719 - 540 = 179 ticks, one short of 180
});

test('re-fire at exactly the 30min delta fires again', () => {
  const r = classifyEngagement({ activeStreakTicks: 720, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 540 });
  assert.deepEqual(r, { label: 'hyperfocus', confidence: 0.6 });
});

test('re-fire uses the gap since last fire, not alignment to a fixed grid', () => {
  // lastHyperfocusFireTick=550 is NOT a multiple of 180 (simulating an
  // earlier fire that landed on a delayed/irregular tick). A naive modulo
  // check (activeStreakTicks % 180 === 0) would miss this boundary
  // entirely (730 % 180 = 10, not 0) — the delta check still fires
  // correctly because the actual gap (730-550=180) has been reached.
  const r = classifyEngagement({ activeStreakTicks: 730, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 550 });
  assert.deepEqual(r, { label: 'hyperfocus', confidence: 0.6 });
});

test('tab-switch distress on this tick suppresses sprint_ready even past threshold', () => {
  const r = classifyEngagement({ activeStreakTicks: 100, activeMode: null, tabSwitchesThisTick: 3, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('2 tab-switches this tick (below the 3+ distress floor) does not suppress', () => {
  const r = classifyEngagement({ activeStreakTicks: 24, activeMode: null, tabSwitchesThisTick: 2, lastHyperfocusFireTick: 0 });
  assert.deepEqual(r, { label: 'sprint_ready', confidence: 0.55 });
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test_signal_classify.mjs`
Expected: fails immediately — `SyntaxError: The requested module '../public/js/engines/signal-detection.js' does not provide an export named 'classifyEngagement'`

- [ ] **Step 3: Implement `classifyEngagement`**

In `public/js/engines/signal-detection.js`, insert the following **between** the existing `const TAB_SWITCH_DEBOUNCE_MS = 5_000;` line and the `class SignalDetectionEngine extends EventTarget {` line:

```js
const TICK_MS = 10_000; // matches the poll interval started in start()

// Active-streak thresholds — see
// docs/superpowers/specs/2026-07-25-sprint-ready-hyperfocus-signal-detection-design.md
const SPRINT_READY_STREAK_MS = 4 * 60_000;
const HYPERFOCUS_STREAK_MS = 90 * 60_000;
const HYPERFOCUS_REFIRE_MS = 30 * 60_000;
const TAB_SWITCH_DISTRESS_PER_TICK = 3;

const SPRINT_READY_STREAK_TICKS = SPRINT_READY_STREAK_MS / TICK_MS;   // 24
const HYPERFOCUS_STREAK_TICKS = HYPERFOCUS_STREAK_MS / TICK_MS;       // 540
const HYPERFOCUS_REFIRE_TICKS = HYPERFOCUS_REFIRE_MS / TICK_MS;       // 180

// Pure decision function: given the current counters, what (if anything)
// should fire? No DOM, no timers, no class state — testable with synthetic
// inputs instead of waiting on real thresholds.
export function classifyEngagement({ activeStreakTicks, activeMode, tabSwitchesThisTick, lastHyperfocusFireTick }) {
  if (tabSwitchesThisTick >= TAB_SWITCH_DISTRESS_PER_TICK) return null;

  if (activeMode === null && activeStreakTicks >= SPRINT_READY_STREAK_TICKS) {
    return { label: 'sprint_ready', confidence: 0.55 };
  }

  if (activeMode === 'focus_sprint' && activeStreakTicks >= HYPERFOCUS_STREAK_TICKS) {
    if (activeStreakTicks - lastHyperfocusFireTick >= HYPERFOCUS_REFIRE_TICKS) {
      return { label: 'hyperfocus', confidence: 0.6 };
    }
  }

  return null;
}
```

The rest of the file (the `SignalDetectionEngine` class and its `export const signalEngine = ...`) is untouched in this step — `classifyEngagement` is not called from anywhere yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test_signal_classify.mjs`
Expected: all 11 lines print `ok - ...`, ending with `11 passed`, exit code 0.

- [ ] **Step 5: Run the app's own gate to confirm no regression**

Run: `python scripts/validate_app.py`
Expected: `[copilot-eval] OK -- app is shippable.` (the new export doesn't change `sw.js` ASSETS, so `[cache] ASSETS unchanged` is expected here too — the `CACHE_NAME` bump happens in Task 6, after all behavior changes land).

- [ ] **Step 6: Commit**

```bash
git add public/js/engines/signal-detection.js scripts/test_signal_classify.mjs
git commit -m "feat: classifyEngagement pure function for sprint_ready/hyperfocus thresholds"
```

---

## Task 2: Stateful active-streak tracking in `SignalDetectionEngine`

**Files:**
- Modify: `public/js/engines/signal-detection.js`
- Create: `scripts/test_signal_engine.mjs`

**Interfaces:**
- Consumes: `classifyEngagement()` from Task 1.
- Produces: `SignalDetectionEngine` (now also exported, not just the `signalEngine` singleton) gains `enterMode(mode: string)`, `clearActiveMode()`, `simulateTicks(n: number)`, and instance fields `activeStreakTicks`, `activeMode`, `lastHyperfocusFireTick`, `sprintReadyFiredThisStreak`, `tabSwitchesThisTick`. The internal poll callback is renamed `checkInactivity` → `_tick` (no longer accurately named — it does more than check inactivity now).

- [ ] **Step 1: Write the failing test**

Create `scripts/test_signal_engine.mjs`:

```js
// scripts/test_signal_engine.mjs
// Stateful SignalDetectionEngine tests: active-streak bookkeeping,
// enterMode/clearActiveMode, and simulateTicks-driven end-to-end firing.
// Run with: node scripts/test_signal_engine.mjs
import assert from 'node:assert/strict';
import { SignalDetectionEngine } from '../public/js/engines/signal-detection.js';

// The dispatch path calls localStorage.getItem, which doesn't exist in
// plain Node — stub it. Module import itself never touches it (only
// firing a state-detected event does), so a plain top-level assignment
// here (before any test runs) is sufficient.
globalThis.localStorage = { getItem: () => null };

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

function freshEngine() {
  const e = new SignalDetectionEngine();
  e.lastActivity = Date.now(); // "just active" baseline; start() is never
  return e;                    // called, so no real DOM listeners attach
}

console.log('SignalDetectionEngine:');

test('simulateTicks accumulates activeStreakTicks while continuously active', () => {
  const e = freshEngine();
  e.simulateTicks(5);
  assert.equal(e.activeStreakTicks, 5);
});

test('sprint_ready fires exactly once when the streak crosses the floor', () => {
  const e = freshEngine();
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(24); // exactly SPRINT_READY_STREAK_TICKS
  e.simulateTicks(24); // stays crossed for a while longer
  assert.deepEqual(fired, ['sprint_ready']); // only once, not every tick
});

test('sprint_ready never fires while a mode is active', () => {
  const e = freshEngine();
  e.enterMode('freeze_rescue');
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(30);
  assert.deepEqual(fired, []);
});

test('clearActiveMode lets sprint_ready fire if the streak already qualifies', () => {
  const e = freshEngine();
  e.enterMode('freeze_rescue');
  e.simulateTicks(30); // streak keeps building even while a mode is active
  e.clearActiveMode();
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(1);
  assert.deepEqual(fired, ['sprint_ready']);
});

test('hyperfocus fires once at the 90min floor, then again after the 30min re-fire gap', () => {
  const e = freshEngine();
  e.enterMode('focus_sprint');
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(540); // exactly HYPERFOCUS_STREAK_TICKS
  assert.deepEqual(fired, ['hyperfocus']);
  e.simulateTicks(179); // one tick short of the 30min re-fire gap
  assert.deepEqual(fired, ['hyperfocus']);
  e.simulateTicks(1); // now exactly at the gap
  assert.deepEqual(fired, ['hyperfocus', 'hyperfocus']);
});

test('a real idle period (90s+) resets the active streak', () => {
  const e = freshEngine();
  e.enterMode('focus_sprint');
  e.simulateTicks(50);
  assert.equal(e.activeStreakTicks, 50);
  e.lastActivity = Date.now() - 95_000; // 95s stale — past INACTIVITY_THRESHOLD_MS
  e.simulateTicks(1);
  assert.equal(e.activeStreakTicks, 0);
});

test('3+ tab-switches in one tick resets the streak (distress override)', () => {
  const e = freshEngine();
  e.simulateTicks(10);
  assert.equal(e.activeStreakTicks, 10);
  e.tabSwitchesThisTick = 3;
  e.simulateTicks(1);
  assert.equal(e.activeStreakTicks, 0);
});

test('2 tab-switches in one tick does not reset the streak', () => {
  const e = freshEngine();
  e.simulateTicks(10);
  e.tabSwitchesThisTick = 2;
  e.simulateTicks(1);
  assert.equal(e.activeStreakTicks, 11);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test_signal_engine.mjs`
Expected: fails immediately — `SyntaxError: The requested module '../public/js/engines/signal-detection.js' does not provide an export named 'SignalDetectionEngine'` (only `classifyEngagement` and the `signalEngine` singleton are exported so far).

- [ ] **Step 3: Implement the stateful engine changes**

In `public/js/engines/signal-detection.js`, replace the entire `class SignalDetectionEngine extends EventTarget { ... }` block (everything from `class SignalDetectionEngine` through its closing `}`, i.e. from `checkInactivity`'s constructor onward) with:

```js
export class SignalDetectionEngine extends EventTarget {
  constructor() {
    super();
    this.lastActivity = Date.now();
    this.tabSwitches = 0;
    this.lastTabSwitch = 0;
    this.tabSwitchesThisTick = 0;
    this.inactivityTimer = null;
    this.isRunning = false;

    // Active-streak state for sprint_ready / hyperfocus (see classifyEngagement above)
    this.activeStreakTicks = 0;
    this.activeMode = null;
    this.lastHyperfocusFireTick = 0;
    this.sprintReadyFiredThisStreak = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    document.addEventListener('click', () => this.recordActivity());
    document.addEventListener('keydown', () => this.recordActivity());
    document.addEventListener('scroll', () => this.recordActivity());
    window.addEventListener('blur', () => this.handleBlur());
    window.addEventListener('focus', () => this.recordActivity());

    this.inactivityTimer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    this.isRunning = false;
    clearInterval(this.inactivityTimer);
  }

  recordActivity() {
    this.lastActivity = Date.now();
  }

  handleBlur() {
    const now = Date.now();
    if (now - this.lastTabSwitch > TAB_SWITCH_DEBOUNCE_MS) {
      this.tabSwitches++;
      this.tabSwitchesThisTick++;
      this.lastTabSwitch = now;
    }
  }

  // Told which mode is active by app.js's showScreen() choke point — kept
  // decoupled from InterventionRouter so the engine dependency graph stays
  // one-directional (signal -> router, never the reverse).
  enterMode(mode) {
    this.activeMode = mode;
  }

  clearActiveMode() {
    this.activeMode = null;
  }

  // One tick of the poll loop. Shared by the real 10s setInterval and by
  // simulateTicks() below, so tests can drive hours of "elapsed time"
  // synchronously instead of waiting on real intervals.
  _tick() {
    const idle = Date.now() - this.lastActivity;

    this._updateActiveStreak(idle);

    if (idle >= INACTIVITY_THRESHOLD_MS) {
      const state = this.inferFromSignals(idle);
      this.dispatchEvent(new CustomEvent('state-detected', { detail: state }));
    } else {
      const candidate = classifyEngagement({
        activeStreakTicks: this.activeStreakTicks,
        activeMode: this.activeMode,
        tabSwitchesThisTick: this.tabSwitchesThisTick,
        lastHyperfocusFireTick: this.lastHyperfocusFireTick
      });

      if (candidate?.label === 'sprint_ready' && !this.sprintReadyFiredThisStreak) {
        // Edge-triggered: fires once per continuous streak, not every tick
        // the threshold stays crossed — without this guard the overlay
        // would reopen every 10s until the user starts a sprint or goes idle.
        this.sprintReadyFiredThisStreak = true;
        this._dispatchEngagement(candidate);
      } else if (candidate?.label === 'hyperfocus') {
        this.lastHyperfocusFireTick = this.activeStreakTicks;
        this._dispatchEngagement(candidate);
      }
    }

    this.tabSwitchesThisTick = 0;
  }

  _updateActiveStreak(idle) {
    const activeThisTick = idle < TICK_MS && this.tabSwitchesThisTick < TAB_SWITCH_DISTRESS_PER_TICK;
    if (activeThisTick) {
      this.activeStreakTicks++;
    } else {
      // Idle, or distressed this tick — the streak resets, and so does
      // everything scoped to "this streak".
      this.activeStreakTicks = 0;
      this.sprintReadyFiredThisStreak = false;
      this.lastHyperfocusFireTick = 0;
    }
  }

  _dispatchEngagement({ label, confidence }) {
    const hour = new Date().getHours();
    const timeOfDay =
      hour < 12 ? 'morning' :
      hour < 17 ? 'afternoon' :
      hour < 21 ? 'evening' : 'night';

    const state = {
      label,
      confidence,
      source: 'signal',
      timestamp: Date.now(),
      contextSnapshot: {
        timeOfDay,
        sessionDurationMinutes: Math.floor((this.activeStreakTicks * TICK_MS) / 60_000),
        lastMode: localStorage.getItem('lastMode') || 'unknown',
        consecutiveFrozenChecks: 0
      }
    };
    this.dispatchEvent(new CustomEvent('state-detected', { detail: state }));
  }

  // Test-only: runs n ticks synchronously instead of waiting on real 10s
  // intervals. See the design spec's testing plan.
  simulateTicks(n) {
    for (let i = 0; i < n; i++) this._tick();
  }

  inferFromSignals(idleMs) {
    const hour = new Date().getHours();
    const timeOfDay =
      hour < 12 ? 'morning' :
      hour < 17 ? 'afternoon' :
      hour < 21 ? 'evening' : 'night';

    // v1 heuristic: simple rules
    let label = 'frozen';
    let confidence = 0.5;

    if (this.tabSwitches > 5) {
      label = 'overwhelmed';
      confidence = 0.6;
    } else if (idleMs > 300_000) {
      label = 'burnt_out';
      confidence = 0.5;
    }

    return {
      label,
      confidence,
      source: 'signal',
      timestamp: Date.now(),
      contextSnapshot: {
        timeOfDay,
        sessionDurationMinutes: Math.floor(idleMs / 60_000),
        lastMode: localStorage.getItem('lastMode') || 'unknown',
        consecutiveFrozenChecks: 0 // TODO: track in memory engine
      }
    };
  }

  // Called by UI when user explicitly picks a state
  reportExplicit(stateLabel) {
    const detail = {
      label: stateLabel,
      confidence: 1.0,
      source: 'explicit',
      timestamp: Date.now(),
      contextSnapshot: {
        timeOfDay: this.inferFromSignals(0).contextSnapshot.timeOfDay,
        sessionDurationMinutes: 0,
        lastMode: localStorage.getItem('lastMode') || 'unknown',
        consecutiveFrozenChecks: 0
      }
    };
    this.dispatchEvent(new CustomEvent('state-detected', { detail }));
  }
}

export const signalEngine = new SignalDetectionEngine();
```

Two things to double-check while editing: the class declaration itself now has `export` in front of it (it didn't before — only the singleton was exported), and `checkInactivity` no longer exists as a name anywhere in the file (renamed to `_tick`, called from `start()`'s `setInterval`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test_signal_engine.mjs`
Expected: all 8 lines print `ok - ...`, ending with `8 passed`, exit code 0.

- [ ] **Step 5: Re-run Task 1's test to confirm no regression**

Run: `node scripts/test_signal_classify.mjs`
Expected: `11 passed` (unchanged — Task 2 didn't modify `classifyEngagement` itself).

- [ ] **Step 6: Run the app's own gate**

Run: `python scripts/validate_app.py`
Expected: `[copilot-eval] OK -- app is shippable.`

- [ ] **Step 7: Commit**

```bash
git add public/js/engines/signal-detection.js scripts/test_signal_engine.mjs
git commit -m "feat: active-streak tracking, enterMode/clearActiveMode, simulateTicks"
```

---

## Task 3: Hyperfocus banner markup + overlay copy rename

**Files:**
- Modify: `public/index.html`
- Modify: `public/css/modes.css`

**Interfaces:**
- Produces: static DOM elements `#hyperfocus-banner` (`hidden` by default), `#hyperfocus-keep-going`, `#hyperfocus-take-break`. `#stuck-no` button text changes from "Not stuck" to "Not now".
- No JS behavior changes in this task — Task 4/5 wire the logic.

**One-time setup for this task and every later Playwright check in this plan:** in your scratch directory (not this repo — Playwright is not and must not become a repo dependency, per Global Constraints), run:

```bash
npm install playwright
npx playwright install chromium
```

If chromium is already cached from a prior session, the second command is a fast no-op. Both scratch-dir `.js` check scripts below assume `node_modules/playwright` is resolvable from wherever you run `node check_*.js` — run them from that same scratch directory.

- [ ] **Step 1: Write the failing check**

This is a markup-only task; "test" here is a small Playwright script confirming the elements exist. Save it to that scratch directory (not committed) as `check_banner_markup.js`:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:4174/index.html'); // adjust port to your local `npx serve public`

  const bannerExists = await page.$('#hyperfocus-banner') !== null;
  const bannerHiddenByDefault = await page.$eval('#hyperfocus-banner', el => el.hidden).catch(() => null);
  const noBtnText = await page.$eval('#stuck-no', el => el.textContent.trim());

  console.log('banner exists:', bannerExists);
  console.log('banner hidden by default:', bannerHiddenByDefault);
  console.log('stuck-no text:', JSON.stringify(noBtnText));
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
```

(Start a local server first: `npx --yes serve -l 4174 public`, in a separate terminal or background process.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node check_banner_markup.js`
Expected: `banner exists: false`, `banner hidden by default: null`, `stuck-no text: "Not stuck"`.

- [ ] **Step 3: Add the markup**

In `public/index.html`, change:

```html
          <button id="stuck-no">Not stuck</button>
```

to:

```html
          <button id="stuck-no">Not now</button>
```

Then, immediately after the closing `</div>` of `<div id="stuck-overlay" ...>...</div>` (still inside `<div id="app">`, right before its own closing `</div>`), add:

```html
    <!-- Hyperfocus Banner — non-blocking, unlike the overlay above. Shown
         while a running focus_sprint has gone unusually long; the timer
         keeps running underneath it. -->
    <div id="hyperfocus-banner" class="banner" hidden>
      <p class="banner-msg">You've been at this a while — in the zone?</p>
      <div class="banner-actions">
        <button id="hyperfocus-keep-going">Keep going</button>
        <button id="hyperfocus-take-break" class="secondary">Take a break</button>
      </div>
    </div>
```

In `public/css/modes.css`, append at the end of the file (after the existing `.retry-btn { ... }` block):

```css

/* Hyperfocus Banner — non-blocking, unlike .overlay above */
.banner {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 90;
  background: var(--bg);
  color: var(--fg);
  padding: 16px;
  border-radius: var(--border-radius);
  box-shadow: 0 12px 32px rgba(0,0,0,0.25);
  max-width: var(--max-width);
  margin: 0 auto;
}

.banner[hidden] {
  display: none;
}

.banner-msg {
  font-size: var(--font-size-base);
  font-weight: 500;
  margin-bottom: 12px;
}

.banner-actions {
  display: flex;
  gap: 10px;
}

.banner-actions button {
  flex: 1;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node check_banner_markup.js`
Expected: `banner exists: true`, `banner hidden by default: true`, `stuck-no text: "Not now"`, `errors: []`.

- [ ] **Step 5: Run the app's own gate**

Run: `python scripts/validate_app.py`
Expected: `[copilot-eval] OK -- app is shippable.` (`sw` check still passes — no `.js`/`.css` files were added or removed, only edited; `.css` isn't listed in `ASSETS` individually per-file in a way this touches — confirm `[cache] ASSETS unchanged` in the output).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/css/modes.css
git commit -m "feat: hyperfocus banner markup, rename overlay dismiss copy to 'Not now'"
```

---

## Task 4: `showScreen(name, mode)` + state-aware confirm overlay

**Files:**
- Modify: `public/js/app.js`

**Interfaces:**
- Consumes: `signalEngine.enterMode(mode)` / `signalEngine.clearActiveMode()` (Task 2), `#hyperfocus-banner` (Task 3).
- Produces: `showScreen(name: string, mode?: string)` — new signature, existing 4 no-mode call sites unaffected, 2 call sites now pass `plan.mode`. `overlayCopyFor(label: string) => { message: string, primaryLabel: string }`.

- [ ] **Step 1: Add the `hyperfocusBanner` DOM ref**

In `public/js/app.js`, find:

```js
const modeContent = document.getElementById('mode-content');
const stuckOverlay = document.getElementById('stuck-overlay');
```

Change to:

```js
const modeContent = document.getElementById('mode-content');
const stuckOverlay = document.getElementById('stuck-overlay');
const hyperfocusBanner = document.getElementById('hyperfocus-banner');
```

- [ ] **Step 2: Replace `showScreen`**

Find:

```js
/* ------------------------------------------------------------------ */
// Navigation helpers
function showScreen(name) {
  // Ambient belongs to the recovery screen only — leaving it must not leave
  // sound running behind your back.
  if (name !== 'mode') ambientEngine.stop();

  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}
```

Replace with:

```js
/* ------------------------------------------------------------------ */
// Navigation helpers
function showScreen(name, mode) {
  // Ambient belongs to the recovery screen only — leaving it must not leave
  // sound running behind your back.
  if (name !== 'mode') ambientEngine.stop();

  // Same idea for the hyperfocus banner: leaving the mode screen by any
  // route (cancel, natural finish, back-to-picker, debrief) must not leave
  // it floating over a screen it no longer applies to.
  if (name !== 'mode') hyperfocusBanner.hidden = true;

  // Told to signalEngine so passive detection knows whether a mode is
  // active, and which one. Kept decoupled from InterventionRouter so the
  // engine dependency graph stays one-directional.
  if (name === 'mode') {
    signalEngine.enterMode(mode);
  } else {
    signalEngine.clearActiveMode();
  }

  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}
```

- [ ] **Step 3: Pass `plan.mode` at the two call sites that enter 'mode'**

Find (inside the `mode-changed` listener):

```js
interventionRouter.addEventListener('mode-changed', (e) => {
  const plan = e.detail;
  interventionRouter.applyUI(plan);
  renderMode(plan);
  showScreen('mode');
});
```

Change the last line to `showScreen('mode', plan.mode);`.

Find (inside `retryWithIntensity`):

```js
function retryWithIntensity(direction) {
  const plan = lastPlan;
  if (!plan) return showScreen('picker');

  showScreen('mode');
```

Change `showScreen('mode');` to `showScreen('mode', plan.mode);`.

All other `showScreen(...)` call sites (`'picker'` in 3 places, `'debrief'` in `showDebrief`) are unchanged — the `mode` parameter is simply `undefined` there, which the `else` branch already handles correctly.

- [ ] **Step 4: State-aware confirm overlay**

Find:

```js
function showStuckOverlay(state) {
  stuckOverlay.hidden = false;

  const yesBtn = document.getElementById('stuck-yes');
  const noBtn = document.getElementById('stuck-no');
  const pickBtn = document.getElementById('stuck-pick');

  const hide = () => { stuckOverlay.hidden = true; };

  yesBtn.onclick = () => { hide(); interventionRouter.route(state); };
  noBtn.onclick = () => { hide(); signalEngine.recordActivity(); };
  pickBtn.onclick = () => { hide(); showScreen('picker'); };
}
```

Replace with:

```js
// Copy for the confirm overlay, by detected label. Everything not listed
// here falls back to DEFAULT_OVERLAY_COPY — frozen/overwhelmed/burnt_out
// intentionally share that default (unchanged copy), only sprint_ready
// needs its own message since it's the opposite mood.
const DEFAULT_OVERLAY_COPY = {
  message: 'You look stuck. Want me to shrink this to two minutes?',
  primaryLabel: 'Yes, help'
};

const OVERLAY_COPY_OVERRIDES = {
  sprint_ready: {
    message: 'You look locked in — want to start a sprint?',
    primaryLabel: 'Yes, start it'
  }
};

function overlayCopyFor(label) {
  return OVERLAY_COPY_OVERRIDES[label] || DEFAULT_OVERLAY_COPY;
}

function showStuckOverlay(state) {
  stuckOverlay.hidden = false;

  const copy = overlayCopyFor(state.label);
  stuckOverlay.querySelector('.overlay-msg').textContent = copy.message;

  const yesBtn = document.getElementById('stuck-yes');
  const noBtn = document.getElementById('stuck-no');
  const pickBtn = document.getElementById('stuck-pick');

  yesBtn.textContent = copy.primaryLabel;

  const hide = () => { stuckOverlay.hidden = true; };

  yesBtn.onclick = () => { hide(); interventionRouter.route(state); };
  noBtn.onclick = () => { hide(); signalEngine.recordActivity(); };
  pickBtn.onclick = () => { hide(); showScreen('picker'); };
}
```

- [ ] **Step 5: Write and run the Playwright wiring check**

Prerequisite: chromium is likely already cached from prior sessions; if not, `npx --yes playwright install chromium`. Serve the app: `npx --yes serve -l 4175 public` (background/separate terminal).

Save to a scratch directory as `check_overlay_and_mode.js`:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:4175/index.html');
  // app.js doesn't attach signalEngine to window — import it directly for
  // this check so the test can dispatch synthetic events on it.
  await page.evaluate(() => import('/js/engines/signal-detection.js').then(m => { window.signalEngine = m.signalEngine; }));

  // sprint_ready gets the new copy
  await page.evaluate(() => {
    window.signalEngine.dispatchEvent(new CustomEvent('state-detected', {
      detail: { label: 'sprint_ready', confidence: 0.55, source: 'signal', timestamp: Date.now(), contextSnapshot: {} }
    }));
  });
  console.log('sprint_ready overlay msg:', await page.textContent('.overlay-msg'));
  console.log('sprint_ready primary label:', await page.textContent('#stuck-yes'));
  await page.click('#stuck-pick'); // dismiss back to picker

  // frozen still gets the original, unchanged copy
  await page.evaluate(() => {
    window.signalEngine.dispatchEvent(new CustomEvent('state-detected', {
      detail: { label: 'frozen', confidence: 0.5, source: 'signal', timestamp: Date.now(), contextSnapshot: {} }
    }));
  });
  console.log('frozen overlay msg:', await page.textContent('.overlay-msg'));
  console.log('frozen primary label:', await page.textContent('#stuck-yes'));
  await page.click('#stuck-yes'); // route into freeze_rescue
  await page.waitForSelector('#primary-action');

  // entering a mode now tells signalEngine
  console.log('activeMode after entering freeze_rescue confirm screen:',
    await page.evaluate(() => window.signalEngine.activeMode));

  await page.click('#back-to-picker');
  console.log('activeMode after returning to picker:',
    await page.evaluate(() => window.signalEngine.activeMode));

  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
```

Run: `node check_overlay_and_mode.js`
Expected:
```
sprint_ready overlay msg: You look locked in — want to start a sprint?
sprint_ready primary label: Yes, start it
frozen overlay msg: You look stuck. Want me to shrink this to two minutes?
frozen primary label: Yes, help
activeMode after entering freeze_rescue confirm screen: freeze_rescue
activeMode after returning to picker: null
errors: []
```

- [ ] **Step 6: Run the app's own gate**

Run: `python scripts/validate_app.py`
Expected: `[copilot-eval] OK -- app is shippable.`

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat: showScreen(name, mode) threads active mode to signalEngine; state-aware overlay"
```

---

## Task 5: Hyperfocus banner behavior

**Files:**
- Modify: `public/js/app.js`

**Interfaces:**
- Consumes: `#hyperfocus-banner`/`#hyperfocus-keep-going`/`#hyperfocus-take-break` (Task 3), `showScreen` (Task 4).
- Produces: `showHyperfocusBanner()`, `initHyperfocusBanner()`. Dispatch fork in the `state-detected` listener: `hyperfocus` → banner, everything else passive → overlay (unchanged).

- [ ] **Step 1: Track the running sprint's interval and plan**

Find (just above `function startSprint(plan, minutes) {`):

```js
function startSprint(plan, minutes) {
  const total = minutes ?? preferredSprintMinutes();
  plan._lastMinutes = total; // so a debrief retry can adjust relative to what actually ran
  let seconds = total * 60;
```

Replace with:

```js
// Hyperfocus banner needs to reach the currently-running sprint's interval
// and plan from outside startSprint's own closure, so "Take a break" can
// reuse #cancel-sprint's exact exit path. null whenever no sprint is running.
let activeSprintInterval = null;
let activeSprintPlan = null;

function startSprint(plan, minutes) {
  const total = minutes ?? preferredSprintMinutes();
  plan._lastMinutes = total; // so a debrief retry can adjust relative to what actually ran
  let seconds = total * 60;
```

- [ ] **Step 2: Set/clear those on sprint start, natural finish, and cancel**

Find:

```js
  const timerEl = document.getElementById('timer');
  const interval = setInterval(() => {
    seconds--;
    timerEl.textContent = clock(seconds);
    if (seconds <= 0) {
      clearInterval(interval);
      speak("Sprint complete. Nice work.");
      finishSprint(plan);
    }
  }, 1000);

  document.getElementById('cancel-sprint').addEventListener('click', () => {
    clearInterval(interval);
    showDebrief(plan, false);
  });
}
```

Replace with:

```js
  const timerEl = document.getElementById('timer');
  const interval = setInterval(() => {
    seconds--;
    timerEl.textContent = clock(seconds);
    if (seconds <= 0) {
      clearInterval(interval);
      activeSprintInterval = null;
      hyperfocusBanner.hidden = true; // nothing left to nudge a break from
      speak("Sprint complete. Nice work.");
      finishSprint(plan);
    }
  }, 1000);

  activeSprintInterval = interval;
  activeSprintPlan = plan;

  document.getElementById('cancel-sprint').addEventListener('click', () => {
    clearInterval(interval);
    activeSprintInterval = null;
    showDebrief(plan, false);
  });
}
```

- [ ] **Step 3: Add `showHyperfocusBanner` / `initHyperfocusBanner`**

Find (the tail end of `retryWithIntensity`, right before the "State routing" section — note `retryWithIntensity` itself sits between `initDebrief` and this point, so anchor on this exact text, not on "after `initDebrief`"):

```js
  // soft_recovery with no sprint run (plain rest) has no graduated
  // intensity axis — re-entering the same mode is the honest behaviour
  // for all three buttons here.
  executeAction(plan);
}

/* ------------------------------------------------------------------ */
// State routing — explicit picks go straight to a mode; passive signals
```

Insert the new block between the `retryWithIntensity` closing `}` and the "State routing" comment:

```js
  // soft_recovery with no sprint run (plain rest) has no graduated
  // intensity axis — re-entering the same mode is the honest behaviour
  // for all three buttons here.
  executeAction(plan);
}

/* ------------------------------------------------------------------ */
// Hyperfocus banner — non-blocking nudge shown while a running focus_sprint
// has gone unusually long. Buttons wired ONCE at init (matching
// initDebrief's fix earlier this session), never rebound per-show, because
// the banner is a static element (never rebuilt via innerHTML).
function initHyperfocusBanner() {
  document.getElementById('hyperfocus-keep-going').addEventListener('click', () => {
    hyperfocusBanner.hidden = true;
  });

  document.getElementById('hyperfocus-take-break').addEventListener('click', () => {
    hyperfocusBanner.hidden = true;
    if (activeSprintInterval) clearInterval(activeSprintInterval);
    activeSprintInterval = null;
    if (activeSprintPlan) showDebrief(activeSprintPlan, false);
  });
}

function showHyperfocusBanner() {
  hyperfocusBanner.hidden = false;
}

/* ------------------------------------------------------------------ */
// State routing — explicit picks go straight to a mode; passive signals
```

- [ ] **Step 4: Fork the dispatch**

Find:

```js
signalEngine.addEventListener('state-detected', (e) => {
  const s = e.detail;
  if (s.source === 'explicit') {
    interventionRouter.route(s);
  } else if (s.source === 'signal' && s.confidence >= 0.5) {
    showStuckOverlay(s);
  }
});
```

Replace with:

```js
signalEngine.addEventListener('state-detected', (e) => {
  const s = e.detail;
  if (s.source === 'explicit') {
    interventionRouter.route(s);
  } else if (s.source === 'signal' && s.confidence >= 0.5) {
    if (s.label === 'hyperfocus') {
      showHyperfocusBanner();
    } else {
      showStuckOverlay(s);
    }
  }
});
```

- [ ] **Step 5: Wire init**

Find:

```js
// Init
initStatePicker();
initTaskPanel();
initDebrief();
signalEngine.start();
```

Replace with:

```js
// Init
initStatePicker();
initTaskPanel();
initDebrief();
initHyperfocusBanner();
signalEngine.start();
```

- [ ] **Step 6: Write and run the Playwright wiring check**

Save to a scratch directory as `check_hyperfocus_banner.js`:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:4175/index.html');
  await page.evaluate(() => import('/js/engines/signal-detection.js').then(m => { window.signalEngine = m.signalEngine; }));

  // Start a real sprint via the UI (sprint_ready -> focus_sprint)
  await page.click('.state-btn[data-state="sprint_ready"]');
  await page.waitForSelector('#primary-action');
  await page.click('#primary-action');
  await page.waitForSelector('#cancel-sprint');

  // Drive the engine straight to the hyperfocus floor
  await page.evaluate(() => window.signalEngine.simulateTicks(540));
  const bannerVisibleAtFloor = await page.evaluate(() => !document.getElementById('hyperfocus-banner').hidden);
  const timerStillRunning = await page.$('#cancel-sprint') !== null;
  console.log('banner visible at 90min floor:', bannerVisibleAtFloor);
  console.log('sprint timer still present (non-blocking):', timerStillRunning);

  // "Keep going" dismisses the banner; then the ordinary #cancel-sprint
  // button (not one of the banner's own buttons) must also auto-hide it
  // via showScreen's leaving-'mode' branch, not leave it stuck on screen.
  await page.click('#hyperfocus-keep-going');
  await page.click('#cancel-sprint');
  await page.waitForSelector('#debrief-screen.active');
  const bannerHiddenAfterCancel = await page.evaluate(() => document.getElementById('hyperfocus-banner').hidden);
  console.log('banner hidden after leaving mode screen:', bannerHiddenAfterCancel);

  // Take a break reuses the real debrief/cancel path
  await page.goto('http://localhost:4175/index.html');
  await page.evaluate(() => import('/js/engines/signal-detection.js').then(m => { window.signalEngine = m.signalEngine; }));
  await page.click('.state-btn[data-state="sprint_ready"]');
  await page.waitForSelector('#primary-action');
  await page.click('#primary-action');
  await page.waitForSelector('#cancel-sprint');
  await page.evaluate(() => window.signalEngine.simulateTicks(540));
  const bannerVisible2 = await page.evaluate(() => !document.getElementById('hyperfocus-banner').hidden);
  console.log('banner visible before take-a-break:', bannerVisible2);
  await page.click('#hyperfocus-take-break');
  await page.waitForSelector('#debrief-screen.active');
  console.log('landed on debrief screen after Take a break: true');

  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
```

Run: `node check_hyperfocus_banner.js`
Expected:
```
banner visible at 90min floor: true
sprint timer still present (non-blocking): true
banner hidden after leaving mode screen: true
banner visible before take-a-break: true
landed on debrief screen after Take a break: true
errors: []
```

- [ ] **Step 7: Run the app's own gate**

Run: `python scripts/validate_app.py`
Expected: `[copilot-eval] OK -- app is shippable.`

- [ ] **Step 8: Commit**

```bash
git add public/js/app.js
git commit -m "feat: non-blocking hyperfocus banner, dispatch fork, sprint interval tracking"
```

---

## Task 6: Regression pass, cache bump, and ship

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Bump `CACHE_NAME`**

In `public/sw.js`, find:

```js
const CACHE_NAME = 'hfc-v3';
```

Change to:

```js
const CACHE_NAME = 'hfc-v4';
```

- [ ] **Step 2: Regression check — today's existing flows still work**

Save to a scratch directory as `check_regression.js` (serve fresh: `npx --yes serve -l 4176 public`):

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const base = 'http://localhost:4176/index.html';

  // freeze_rescue retry tier escalation
  let page = await browser.newPage();
  await page.goto(base);
  await page.click('#task-toggle');
  await page.fill('#task-input', 'Regression task');
  await page.press('#task-input', 'Enter');
  await page.waitForSelector('.task-item');
  await page.click('.state-btn[data-state="frozen"]');
  await page.waitForSelector('#primary-action');
  await page.click('#primary-action');
  await page.waitForSelector('#done-step');
  const tier0 = await page.textContent('#mode-content .sub');
  await page.click('#done-step');
  await page.click('.debrief-btn[data-score="1"]');
  await page.click('.retry-btn[data-delta="-1"]');
  const tier1 = await page.textContent('#mode-content .sub');
  console.log('freeze_rescue tier0 -> tier1 differ:', tier0 !== tier1);

  // sprint length ladder
  page = await browser.newPage();
  await page.goto(base);
  await page.click('.state-btn[data-state="sprint_ready"]');
  await page.waitForSelector('#primary-action');
  await page.click('#primary-action');
  await page.waitForSelector('#cancel-sprint');
  const before = await page.textContent('#timer');
  await page.click('#cancel-sprint');
  await page.click('.debrief-btn[data-score="1"]');
  await page.click('.retry-btn[data-delta="-1"]');
  await page.waitForSelector('#cancel-sprint');
  const after = await page.textContent('#timer');
  console.log('sprint timer before/after softer:', before.trim(), after.trim());

  // wobbly dip -> harder -> real sprint
  page = await browser.newPage();
  await page.goto(base);
  await page.click('.state-btn[data-state="wobbly"]');
  await page.waitForSelector('#primary-action');
  await page.click('#primary-action');
  await page.waitForSelector('#test-water');
  await page.click('#test-water');
  await page.waitForSelector('#cancel-sprint');
  await page.click('#cancel-sprint');
  await page.click('.debrief-btn[data-score="1"]');
  await page.click('.retry-btn[data-delta="1"]');
  await page.waitForSelector('#cancel-sprint');
  const wobblyAfterHarder = await page.textContent('#timer');
  console.log('wobbly dip after harder:', wobblyAfterHarder.trim());

  // plain burnt_out recovery
  page = await browser.newPage();
  await page.goto(base);
  await page.click('.state-btn[data-state="burnt_out"]');
  await page.waitForSelector('#primary-action');
  await page.click('#primary-action');
  await page.waitForSelector('#exit-recovery');
  await page.click('#exit-recovery');
  await page.click('.debrief-btn[data-score="1"]');
  await page.click('.retry-btn[data-delta="0"]');
  await page.waitForSelector('#mode-content h1');
  const recoveryHeadline = await page.textContent('#mode-content h1');
  console.log('burnt_out same-again headline:', recoveryHeadline.trim());

  await browser.close();
})();
```

Run: `node check_regression.js`
Expected:
```
freeze_rescue tier0 -> tier1 differ: true
sprint timer before/after softer: 25:00 15:00
wobbly dip after harder: 15:00
burnt_out same-again headline: Rest is the task right now
```

- [ ] **Step 3: Run the app's own gate**

Run: `python scripts/validate_app.py`
Expected: `[cache] ASSETS unchanged` still (no files added/removed) — `CACHE_NAME` bump is a convention this repo follows on top of the gate, not something the gate itself demands. Overall result: `[copilot-eval] OK -- app is shippable.`

- [ ] **Step 4: Commit**

```bash
git add public/sw.js
git commit -m "chore: bump CACHE_NAME to hfc-v4 for the sprint_ready/hyperfocus behavior change"
```

- [ ] **Step 5: Fetch, then push**

```bash
git fetch
git status --short --branch
git push
```

Expected: the pre-push hook runs `validate_app.py` and prints `[copilot-eval] OK -- push proceeding.` before the push completes.

---

## Self-Review Notes

**Spec coverage:** every section of the design spec maps to a task — detection mechanism (Tasks 1–2), "knowing the current mode" (Task 4), overlay state-awareness (Task 4), hyperfocus banner (Tasks 3 & 5), testing plan's two layers (Tasks 1–2 for pure/stateful, Tasks 4–6 for Playwright wiring + regression), `CACHE_NAME` bump (Task 6).

**Type consistency checked:** `classifyEngagement`'s parameter names (`activeStreakTicks`, `activeMode`, `tabSwitchesThisTick`, `lastHyperfocusFireTick`) are identical in Task 1's implementation, Task 1's test calls, and Task 2's `_tick()` call site. `enterMode`/`clearActiveMode` names match between Task 2's implementation and Task 4's `showScreen` usage. `showHyperfocusBanner`/`initHyperfocusBanner` names match between Task 5's implementation and its call sites.

**Cross-task dependency resolved during planning:** Task 4's `showScreen` references `hyperfocusBanner`, which only exists in the DOM after Task 3 — tasks are ordered so markup (Task 3) lands before the JS that reads it (Task 4), avoiding a null-ref that a naive "engine first, then all of app.js" ordering would have hit.

**Bugs caught and fixed during this self-review pass** (fixed inline, not re-reviewed after):
- Task 5's insertion point for `initHyperfocusBanner`/`showHyperfocusBanner` was given as two contradictory locations ("immediately after `initDebrief`" vs. "right before the State routing comment") — `retryWithIntensity` sits between those two points in the real file, so only one could be correct. Replaced with a single unambiguous Find/Insert anchor.
- Task 4 Step 5's Playwright script needed `window.signalEngine` to dispatch synthetic events, but the surrounding prose described adding that as an afterthought rather than showing it in the code. Moved the `import()`-and-attach line into the script itself, right after `page.goto`.
- Task 5 Step 6's script had a dead, self-canceling selector (`'#hyperfocus-take-break:not([hidden])'.replace(':not([hidden])', '')`, which just evaluates to the plain selector) and a comment ("Never fires outside focus_sprint") that didn't describe what the block it sat on top of actually tested. Removed the dead code, fixed the comment.
- Every Playwright check script was named `.mjs` but written in CommonJS (`require('playwright')`) — Node treats `.mjs` as ESM unconditionally regardless of any `package.json`, so `require` would throw immediately. Renamed all four to `.js`, matching this repo's actual working convention from today's session (CommonJS scratch scripts, no `"type": "module"`). Added the missing one-time `npm install playwright` prerequisite to Task 3, which no step had stated before.

**Bug found during Task 1's execution (missed in the original self-review, fixed post-hoc):** Task 1's exact given `classifyEngagement` code and its exact given test 6 contradicted each other — at `activeStreakTicks: 540, activeMode: null`, the given code returns `sprint_ready` (540 ≥ 24 is true), but the given test expected `null`. A task-reviewer subagent caught it when the implementer papered over the contradiction with an undocumented upper-bound cap on `sprint_ready` instead of surfacing it. Resolved (human decision, 2026-07-25): the code stays exactly as spec'd — no upper bound, since one isn't in the design doc and a user active 90+min without ever starting a sprint should still get nudged — and test 6's scenario (not its expected value) was fixed to use `activeMode: 'freeze_rescue'`, matching the isolation pattern the test above it already uses. Both this plan's Task 1 code block and the actual repo files are corrected to match.
