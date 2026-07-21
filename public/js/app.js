// app.js — Main entry point for Hyperfocus Co-Pilot v1
// Wires together the three engines and handles UI flows.

import { signalEngine } from './engines/signal-detection.js';
import { interventionRouter } from './engines/intervention-router.js';
import { memoryEngine } from './engines/memory-recall.js';

/* ------------------------------------------------------------------ */
// Service Worker (PWA offline support)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

/* ------------------------------------------------------------------ */
// DOM refs
const screens = {
  picker: document.getElementById('state-picker'),
  mode: document.getElementById('mode-screen'),
  debrief: document.getElementById('debrief-screen')
};
const modeContent = document.getElementById('mode-content');
const stuckOverlay = document.getElementById('stuck-overlay');

/* ------------------------------------------------------------------ */
// Navigation helpers
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

/* ------------------------------------------------------------------ */
// State Picker → explicit report
function initStatePicker() {
  document.querySelectorAll('.state-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const state = btn.dataset.state;
      signalEngine.reportExplicit(state);
    });
  });
}

/* ------------------------------------------------------------------ */
// Intervention Router → mode render
interventionRouter.addEventListener('mode-changed', (e) => {
  const plan = e.detail;
  interventionRouter.applyUI(plan);
  renderMode(plan);
  showScreen('mode');
});

function renderMode(plan) {
  const action = plan.suggestedAction;

  // Check memory for a better suggestion
  const memoryTip = memoryEngine.bestTip({ label: plan.mode === 'freeze_rescue' ? 'frozen' : 'sprint_ready' });

  modeContent.innerHTML = `
    <header>
      <h1>${action.headline}</h1>
      <p class="sub">${action.body}</p>
      ${memoryTip ? `<p class="memory-tip">💡 ${memoryTip}</p>` : ''}
    </header>
    <div class="mode-actions">
      <button id="primary-action">${action.cta}</button>
      <button class="secondary" id="back-to-picker">← Pick different state</button>
    </div>
  `;

  document.getElementById('primary-action').addEventListener('click', () => {
    executeAction(plan);
  });

  document.getElementById('back-to-picker').addEventListener('click', () => {
    showScreen('picker');
  });
}

/* ------------------------------------------------------------------ */
// Execute action inside a mode
function executeAction(plan) {
  if (plan.mode === 'freeze_rescue') {
    const step = generateMicroStep();
    speak(step);
    modeContent.innerHTML = `
      <header>
        <h1>Your micro-step</h1>
        <p class="sub" style="font-size:1.2em; margin-top:12px;">${step}</p>
      </header>
      <div class="mode-actions">
        <button id="done-step">✅ Done</button>
        <button class="secondary" id="too-big">Still too big</button>
      </div>
    `;
    document.getElementById('done-step').addEventListener('click', () => showDebrief(plan, true));
    document.getElementById('too-big').addEventListener('click', () => {
      speak("Okay. Let's make it smaller.");
      executeAction(plan); // regenerate even tinier (v1: same logic)
    });
  }

  if (plan.mode === 'focus_sprint') {
    startSprint(plan);
  }

  if (plan.mode === 'soft_recovery') {
    modeContent.innerHTML = `
      <header>
        <h1>Rest is the task right now</h1>
        <p class="sub">Nothing else needed. Breathe. You're allowed to stop.</p>
      </header>
      <div class="mode-actions">
        <button id="play-ambient">▶ Play soft sound</button>
        <button class="secondary" id="log-drain">Log what drained you</button>
        <button class="secondary" id="exit-recovery">I'm ready to exit</button>
      </div>
    `;
    document.getElementById('play-ambient').addEventListener('click', () => {
      speak("Playing ambient sound. Rest now.");
    });
    document.getElementById('exit-recovery').addEventListener('click', () => showDebrief(plan, true));
  }
}

/* ------------------------------------------------------------------ */
// Micro-step generator (v1: static pool)
const MICRO_STEPS = [
  "Just open the document. That's it. I'll wait.",
  "Write one sentence. It can be bad. Just one.",
  "Open the app you need. Don't do anything else yet.",
  "Find the file. Double-click it. Done.",
  "Write the title. That's the whole step.",
  "Set a timer for 2 minutes. Start. Stop whenever.",
  "Open your notes and read the first line."
];

function generateMicroStep() {
  return MICRO_STEPS[Math.floor(Math.random() * MICRO_STEPS.length)];
}

/* ------------------------------------------------------------------ */
// Focus Sprint timer (v1: simple countdown)
function startSprint(plan) {
  let seconds = 25 * 60;
  modeContent.innerHTML = `
    <header style="text-align:center;">
      <div id="timer" style="font-size:64px; font-weight:700; font-variant-numeric:tabular-nums;">25:00</div>
      <p class="sub">One thing. I'll nudge you at the end.</p>
    </header>
    <div class="mode-actions" style="justify-content:center;">
      <button id="cancel-sprint" class="secondary">Cancel</button>
    </div>
  `;

  const timerEl = document.getElementById('timer');
  const interval = setInterval(() => {
    seconds--;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    if (seconds <= 0) {
      clearInterval(interval);
      speak("Sprint complete. Nice work.");
      showDebrief(plan, true);
    }
  }, 1000);

  document.getElementById('cancel-sprint').addEventListener('click', () => {
    clearInterval(interval);
    showDebrief(plan, false);
  });
}

/* ------------------------------------------------------------------ */
// TTS (Web Speech API)
function speak(text) {
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.9;
  utter.pitch = 1.0;
  // Try to find a warm voice (heuristic: prefer non-default, non-Google US)
  const voices = window.speechSynthesis.getVoices();
  const warm = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female'));
  if (warm) utter.voice = warm;
  window.speechSynthesis.speak(utter);
}

/* ------------------------------------------------------------------ */
// Debrief
function showDebrief(plan, completed) {
  showScreen('debrief');

  // One-shot debrief listeners
  const debriefBtns = document.querySelectorAll('.debrief-btn');
  const followup = document.querySelector('.debrief-followup');

  const handler = (e) => {
    const score = parseInt(e.target.dataset.score, 10);
    memoryEngine.record({
      detectedState: plan.mode === 'freeze_rescue' ? 'frozen' : plan.mode === 'focus_sprint' ? 'sprint_ready' : 'burnt_out',
      mode: plan.mode,
      intervention: plan.suggestedAction.type,
      contextSnapshot: {},
      outcomeScore: score
    });

    if (score <= 3) {
      followup.hidden = false;
    } else {
      setTimeout(() => showScreen('picker'), 800);
    }

    debriefBtns.forEach(b => b.removeEventListener('click', handler));
  };

  debriefBtns.forEach(btn => btn.addEventListener('click', handler));

  document.querySelectorAll('.retry-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen('picker'));
  });
}

/* ------------------------------------------------------------------ */
// Stuck detection overlay
signalEngine.addEventListener('state-detected', (e) => {
  const s = e.detail;
  // Only react to signal-based detections with gentle confirm
  if (s.source === 'signal' && s.confidence >= 0.5) {
    showStuckOverlay(s);
  }
});

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

/* ------------------------------------------------------------------ */
// Init
initStatePicker();
signalEngine.start();

// Log ready
console.log('🧠 Hyperfocus Co-Pilot v1 loaded');
console.log('Engines:', { signalEngine, interventionRouter, memoryEngine });
