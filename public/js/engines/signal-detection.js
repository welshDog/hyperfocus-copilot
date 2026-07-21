// engines/signal-detection.js
// Signal Detection Engine — v1
// Detects user state from passive signals + explicit input

const INACTIVITY_THRESHOLD_MS = 90_000; // 90 seconds; user-configurable in v2
const TAB_SWITCH_DEBOUNCE_MS = 5_000;

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
