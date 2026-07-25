// engines/signal-detection.js
// Signal Detection Engine — v1
// Detects user state from passive signals + explicit input

const INACTIVITY_THRESHOLD_MS = 90_000; // 90 seconds; user-configurable in v2
const TAB_SWITCH_DEBOUNCE_MS = 5_000;

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
