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

class SignalDetectionEngine extends EventTarget {
  constructor() {
    super();
    this.lastActivity = Date.now();
    this.tabSwitches = 0;
    this.lastTabSwitch = 0;
    this.inactivityTimer = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    document.addEventListener('click', () => this.recordActivity());
    document.addEventListener('keydown', () => this.recordActivity());
    document.addEventListener('scroll', () => this.recordActivity());
    window.addEventListener('blur', () => this.handleBlur());
    window.addEventListener('focus', () => this.recordActivity());

    this.inactivityTimer = setInterval(() => this.checkInactivity(), 10_000);
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
      this.lastTabSwitch = now;
    }
  }

  checkInactivity() {
    const idle = Date.now() - this.lastActivity;
    if (idle >= INACTIVITY_THRESHOLD_MS) {
      const state = this.inferFromSignals(idle);
      this.dispatchEvent(new CustomEvent('state-detected', { detail: state }));
    }
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
