// engines/intervention-router.js
// Intervention Routing Engine — v1
// Maps detected states to support modes, UI profiles, and actions

const MODE_CONFIG = {
  freeze_rescue: {
    uiProfile: 'chunky-muted',
    tone: 'gentle',
    cssVars: {
      '--bg': '#f5f2ed',
      '--fg': '#2d2a26',
      '--accent': '#d4a373',
      '--btn-min-height': '72px',
      '--font-size-base': '18px',
      '--motion-duration': '0ms',
      '--border-radius': '16px'
    }
  },
  focus_sprint: {
    uiProfile: 'minimal-dark',
    tone: 'quiet',
    cssVars: {
      '--bg': '#1a1a1a',
      '--fg': '#e8e8e8',
      '--accent': '#6b9bd1',
      '--btn-min-height': '48px',
      '--font-size-base': '16px',
      '--motion-duration': '200ms',
      '--border-radius': '8px'
    }
  },
  soft_recovery: {
    uiProfile: 'soft-pastel',
    tone: 'warm',
    cssVars: {
      '--bg': '#faf6f1',
      '--fg': '#5c5048',
      '--accent': '#a3b899',
      '--btn-min-height': '56px',
      '--font-size-base': '17px',
      '--motion-duration': '800ms',
      '--border-radius': '20px'
    }
  }
};

const STATE_MODE_MAP = {
  frozen: 'freeze_rescue',
  overwhelmed: 'freeze_rescue',
  sprint_ready: 'focus_sprint',
  hyperfocus: 'focus_sprint',
  burnt_out: 'soft_recovery',
  wobbly: 'soft_recovery'
};

class InterventionRouter extends EventTarget {
  constructor() {
    super();
    this.currentMode = null;
  }

  route(detectedState) {
    const mode = STATE_MODE_MAP[detectedState.label] || 'soft_recovery';
    const config = MODE_CONFIG[mode];

    const plan = {
      mode,
      detectedState: detectedState.label, // keep the true state so Memory recalls all 6, not just the 3 modes
      uiProfile: config.uiProfile,
      tone: config.tone,
      cssVars: config.cssVars,
      suggestedAction: this.pickAction(mode, detectedState),
      autoTrigger: false // v1: never auto-switch without confirmation
    };

    this.currentMode = mode;
    localStorage.setItem('lastMode', mode);
    this.dispatchEvent(new CustomEvent('mode-changed', { detail: plan }));
    return plan;
  }

  pickAction(mode, state) {
    // v1: static rules. v2: query memory engine.
    const actions = {
      freeze_rescue: {
        type: 'micro_step',
        headline: 'Just one tiny step',
        body: 'I\'ve picked your top task and broken it down. Ready?',
        cta: 'Show me the step'
      },
      focus_sprint: {
        type: 'sprint_start',
        headline: '25 minutes. One thing.',
        body: 'Your task is locked in. I\'ll nudge you at the end.',
        cta: 'Start sprint'
      },
      soft_recovery: {
        type: 'ambient_rest',
        headline: 'Rest is the task right now',
        body: 'Nothing else needed. Breathe. You\'re allowed to stop.',
        cta: 'Play ambient sound'
      }
    };
    return actions[mode];
  }

  applyUI(plan) {
    const root = document.documentElement;
    Object.entries(plan.cssVars).forEach(([key, val]) => {
      root.style.setProperty(key, val);
    });
    document.body.setAttribute('data-mode', plan.mode);
    document.body.setAttribute('data-ui-profile', plan.uiProfile);
  }
}

export const interventionRouter = new InterventionRouter();
