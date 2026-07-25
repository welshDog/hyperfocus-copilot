// app.js — Main entry point for Hyperfocus Co-Pilot v1
// Wires together the three engines and handles UI flows.

import { signalEngine } from './engines/signal-detection.js';
import { interventionRouter } from './engines/intervention-router.js';
import { memoryEngine } from './engines/memory-recall.js';
import { taskList } from './engines/task-list.js';
import { ambientEngine } from './engines/ambient.js';

/* ------------------------------------------------------------------ */
// Task titles are user input and every render path below goes through
// innerHTML — escape before interpolating, always.
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

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
const hyperfocusBanner = document.getElementById('hyperfocus-banner');

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

/* ------------------------------------------------------------------ */
// Task panel — add / promote / complete / delete
const taskEls = {
  toggle: document.getElementById('task-toggle'),
  summary: document.getElementById('task-summary'),
  body: document.getElementById('task-body'),
  form: document.getElementById('task-form'),
  input: document.getElementById('task-input'),
  items: document.getElementById('task-items'),
  empty: document.getElementById('task-empty')
};

function renderTasks() {
  const all = taskList.all();
  const active = taskList.active();
  const top = taskList.top();

  taskEls.summary.textContent = active.length
    ? `Top task: ${top.title}`
    : 'No tasks yet';

  taskEls.empty.hidden = all.length > 0;

  taskEls.items.innerHTML = all.map(t => `
    <li class="task-item ${t.done ? 'is-done' : ''} ${top && t.id === top.id ? 'is-top' : ''}"
        data-id="${esc(t.id)}">
      <button class="task-btn" data-act="toggle"
              aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">
        ${t.done ? '✅' : '⬜'}
      </button>
      <span class="task-title">${esc(t.title)}</span>
      ${top && t.id === top.id ? '<span class="task-badge">Top</span>' : ''}
      ${!t.done && !(top && t.id === top.id)
        ? `<button class="task-btn" data-act="promote" aria-label="Make this the top task: ${esc(t.title)}">⬆</button>`
        : ''}
      <button class="task-btn" data-act="remove" aria-label="Delete: ${esc(t.title)}">✕</button>
    </li>
  `).join('');
}

function initTaskPanel() {
  taskEls.toggle.addEventListener('click', () => {
    const open = taskEls.toggle.getAttribute('aria-expanded') === 'true';
    taskEls.toggle.setAttribute('aria-expanded', String(!open));
    taskEls.body.hidden = open;
  });

  taskEls.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const added = taskList.add(taskEls.input.value);
    if (added) taskEls.input.value = '';
    taskEls.input.focus();
  });

  // Delegated — the list re-renders on every change.
  taskEls.items.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-btn');
    if (!btn) return;
    const id = btn.closest('.task-item')?.dataset.id;
    if (!id) return;

    const act = btn.dataset.act;
    if (act === 'toggle') {
      const t = taskList.get(id);
      if (t?.done) taskList.uncomplete(id); else taskList.complete(id);
    } else if (act === 'promote') {
      taskList.promote(id);
    } else if (act === 'remove') {
      taskList.remove(id);
    }
  });

  taskList.addEventListener('tasks-changed', renderTasks);
  renderTasks();
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
  showScreen('mode', plan.mode);
});

function renderMode(plan) {
  const action = plan.suggestedAction;

  // Check memory for a better suggestion (keyed on the true state, not the mode)
  const memoryTip = memoryEngine.bestTip({ label: plan.detectedState });

  // Sprint length is the user's call, and the choice sticks.
  const chosen = preferredSprintMinutes();
  const lengthPicker = plan.mode === 'focus_sprint'
    ? `<div class="length-picker" role="group" aria-label="Sprint length">
         ${SPRINT_CHOICES.map(m => `
           <button class="length-btn${m === chosen ? ' is-chosen' : ''}"
                   data-minutes="${m}"
                   aria-pressed="${m === chosen}">${m} min</button>
         `).join('')}
       </div>`
    : '';

  modeContent.innerHTML = `
    <header>
      <h1>${esc(action.headline)}</h1>
      <p class="sub">${esc(action.body)}</p>
      ${memoryTip ? `<p class="memory-tip">💡 ${esc(memoryTip)}</p>` : ''}
    </header>
    ${lengthPicker}
    <div class="mode-actions">
      <button id="primary-action">${esc(action.cta)}</button>
      <button class="secondary" id="back-to-picker">← Pick different state</button>
    </div>
  `;

  modeContent.querySelectorAll('.length-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem(SPRINT_KEY, btn.dataset.minutes);
      modeContent.querySelectorAll('.length-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-chosen', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
  });

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
    // Escalate through progressively smaller steps each time the user says
    // "still too big" — v1 regenerated the same size forever, which is the
    // exact moment a frozen brain gives up.
    plan._stepTier = Math.min((plan._stepTier ?? 0), MICRO_STEPS.length - 1);
    const step = generateMicroStep(plan.task, plan._stepTier);
    speak(step);
    const atSmallest = plan._stepTier >= MICRO_STEPS.length - 1;

    modeContent.innerHTML = `
      <header>
        <h1>Your micro-step</h1>
        <p class="sub" style="font-size:1.2em; margin-top:12px;">${esc(step)}</p>
        ${plan.task ? `<span class="task-chip">📌 ${esc(plan.task.title)}</span>` : ''}
      </header>
      <div class="mode-actions">
        <button id="done-step">✅ Done</button>
        ${atSmallest ? '' : '<button class="secondary" id="too-big">Still too big</button>'}
      </div>
    `;

    document.getElementById('done-step').addEventListener('click', () => showDebrief(plan, true));

    const tooBig = document.getElementById('too-big');
    if (tooBig) {
      tooBig.addEventListener('click', () => {
        speak("Okay. Let's make it smaller.");
        plan._stepTier = (plan._stepTier ?? 0) + 1;
        executeAction(plan);
      });
    }
  }

  if (plan.mode === 'focus_sprint') {
    startSprint(plan);
  }

  if (plan.mode === 'soft_recovery') {
    // "Wobbly" is not "burnt out": the PRD keeps the task list peekable and
    // offers a 5-minute test-the-water sprint — a way back in that doesn't
    // demand a full 25.
    const wobbly = plan.detectedState === 'wobbly';

    modeContent.innerHTML = `
      <header>
        <h1>${wobbly ? 'No pressure either way' : 'Rest is the task right now'}</h1>
        <p class="sub">${wobbly
          ? 'You could rest, or dip a toe in for five minutes and stop. Both are fine.'
          : 'Nothing else needed. Breathe. You\'re allowed to stop.'}</p>
        ${wobbly && plan.task ? `<span class="task-chip">📌 ${esc(plan.task.title)}</span>` : ''}
      </header>
      <div class="mode-actions">
        ${wobbly ? '<button id="test-water">🌤️ Try 5 minutes</button>' : ''}
        <button ${wobbly ? 'class="secondary"' : ''} id="play-ambient">▶ Play soft sound</button>
        <button class="secondary" id="log-drain">Log what drained you</button>
        <button class="secondary" id="exit-recovery">I'm ready to exit</button>
      </div>
      <p id="ambient-note" class="task-empty" hidden></p>
    `;

    const testWater = document.getElementById('test-water');
    if (testWater) {
      testWater.addEventListener('click', () => {
        ambientEngine.stop();
        startSprint(plan, 5);
      });
    }

    const ambientBtn = document.getElementById('play-ambient');
    const ambientNote = document.getElementById('ambient-note');

    if (!ambientEngine.supported) {
      // Say so rather than pretending — the fake version of this button is
      // exactly what we're replacing.
      ambientBtn.disabled = true;
      ambientBtn.textContent = 'Soft sound unavailable here';
      ambientNote.hidden = false;
      ambientNote.textContent = 'This browser has no Web Audio support.';
    } else {
      ambientBtn.addEventListener('click', async () => {
        const nowPlaying = await ambientEngine.toggle();
        ambientBtn.textContent = nowPlaying ? '⏸ Stop soft sound' : '▶ Play soft sound';
      });
    }
    document.getElementById('log-drain').addEventListener('click', () => {
      modeContent.innerHTML = `
        <header>
          <h1>What drained you?</h1>
          <p class="sub">No pressure. A few words is plenty.</p>
        </header>
        <textarea id="drain-note" rows="3" placeholder="e.g. too many tabs, a hard conversation, skipped lunch..."></textarea>
        <div class="mode-actions">
          <button id="save-drain">Save it</button>
          <button class="secondary" id="skip-drain">Skip</button>
        </div>
      `;
      document.getElementById('save-drain').addEventListener('click', () => {
        const note = document.getElementById('drain-note').value.trim();
        memoryEngine.record({
          detectedState: plan.detectedState,
          mode: plan.mode,
          intervention: 'drain_log',
          contextSnapshot: {},
          outcomeScore: 3,
          outcomeNote: note
        });
        speak("Logged. Now rest.");
        showDebrief(plan, true);
      });
      document.getElementById('skip-drain').addEventListener('click', () => showDebrief(plan, true));
    });
    document.getElementById('exit-recovery').addEventListener('click', () => showDebrief(plan, true));
  }
}

/* ------------------------------------------------------------------ */
// Micro-step generator
// Tiers get smaller as the user taps "still too big". Each tier has a
// task-aware phrasing and a generic fallback for an empty list — the app
// must never pretend a task exists.
const MICRO_STEPS = [
  {
    withTask: t => `Open whatever you need for "${t}". Nothing else yet.`,
    generic: "Open the app you need. Don't do anything else yet."
  },
  {
    withTask: t => `Write one bad sentence about "${t}". It can be rubbish.`,
    generic: 'Write one sentence. It can be bad. Just one.'
  },
  {
    withTask: t => `Set a 2-minute timer and poke at "${t}". Stop whenever.`,
    generic: 'Set a timer for 2 minutes. Start. Stop whenever.'
  },
  {
    withTask: t => `Just type the words "${t}" somewhere. That's the whole step.`,
    generic: 'Write the title. That is the whole step.'
  },
  {
    withTask: () => 'Sit down and look at the screen for 30 seconds. No doing.',
    generic: 'Sit down and look at the screen for 30 seconds. No doing.'
  }
];

function generateMicroStep(task, tier = 0) {
  const step = MICRO_STEPS[Math.min(tier, MICRO_STEPS.length - 1)];
  return task ? step.withTask(task.title) : step.generic;
}

/* ------------------------------------------------------------------ */
// Focus Sprint timer (v1: simple countdown)
// Sprint length is configurable (PRD). An explicit minutes argument wins —
// that's the 5-minute test-the-water dip; otherwise use the user's saved
// preference.
const SPRINT_KEY = 'hfc_sprint_minutes_v1';
const SPRINT_CHOICES = [15, 25, 45];
const DEFAULT_SPRINT = 25;

function preferredSprintMinutes() {
  const saved = parseInt(localStorage.getItem(SPRINT_KEY), 10);
  return SPRINT_CHOICES.includes(saved) ? saved : DEFAULT_SPRINT;
}

// Hyperfocus banner needs to reach the currently-running sprint's interval
// and plan from outside startSprint's own closure, so "Take a break" can
// reuse #cancel-sprint's exact exit path. null whenever no sprint is running.
let activeSprintInterval = null;
let activeSprintPlan = null;

function startSprint(plan, minutes) {
  const total = minutes ?? preferredSprintMinutes();
  plan._lastMinutes = total; // so a debrief retry can adjust relative to what actually ran
  let seconds = total * 60;
  const clock = (secs) =>
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  modeContent.innerHTML = `
    <header style="text-align:center;">
      <div id="timer" style="font-size:64px; font-weight:700; font-variant-numeric:tabular-nums;">${clock(seconds)}</div>
      <p class="sub">${plan.task ? 'This one thing. I\'ll nudge you at the end.' : 'No task set — just start. I\'ll nudge you at the end.'}</p>
      ${plan.task ? `<span class="task-chip">📌 ${esc(plan.task.title)}</span>` : ''}
    </header>
    <div class="mode-actions" style="justify-content:center;">
      <button id="cancel-sprint" class="secondary">Cancel</button>
    </div>
  `;

  const timerEl = document.getElementById('timer');
  const interval = setInterval(() => {
    seconds--;
    timerEl.textContent = clock(seconds);
    if (seconds <= 0) {
      clearInterval(interval);
      activeSprintInterval = null;
      activeSprintPlan = null;
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
    activeSprintPlan = null;
    showDebrief(plan, false);
  });
}

/* ------------------------------------------------------------------ */
// Sprint end — offer to tick the task off. Closing the loop on the real
// list is what makes the "locked in" promise mean anything.
function finishSprint(plan) {
  if (!plan.task) return showDebrief(plan, true);

  modeContent.innerHTML = `
    <header>
      <h1>Sprint complete</h1>
      <p class="sub">Nice work. Did you finish it?</p>
      <span class="task-chip">📌 ${esc(plan.task.title)}</span>
    </header>
    <div class="mode-actions">
      <button id="task-done">✅ Mark it done</button>
      <button class="secondary" id="task-keep">Keep it on the list</button>
    </div>
  `;

  document.getElementById('task-done').addEventListener('click', () => {
    taskList.complete(plan.task.id);
    showDebrief(plan, true);
  });
  document.getElementById('task-keep').addEventListener('click', () => showDebrief(plan, true));
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
let lastPlan = null; // so the retry buttons know what to adjust

function showDebrief(plan, completed) {
  lastPlan = plan;
  showScreen('debrief');

  // One-shot debrief listeners
  const debriefBtns = document.querySelectorAll('.debrief-btn');
  const followup = document.querySelector('.debrief-followup');

  // Re-hide the follow-up. Without this, one low score leaves "want to try
  // something different?" stuck on screen for every debrief afterwards.
  followup.hidden = true;

  const handler = (e) => {
    const score = parseInt(e.target.dataset.score, 10);
    memoryEngine.record({
      detectedState: plan.detectedState,
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
}

// Retry buttons are wired ONCE at init. Re-binding them inside showDebrief
// stacked a fresh listener every debrief, so by the fifth session one tap
// fired five handlers.
function initDebrief() {
  document.querySelectorAll('.retry-btn').forEach(btn => {
    const delta = parseInt(btn.dataset.delta, 10) || 0;
    btn.addEventListener('click', () => retryWithIntensity(delta));
  });
}

// "Try softer" / "Try harder" / "Same again" — move along whichever
// intensity axis the last mode actually has, then jump straight back into
// it (no re-confirm screen; that's the whole point of a one-tap retry).
// -1 = softer, 0 = same, +1 = harder.
function retryWithIntensity(direction) {
  const plan = lastPlan;
  if (!plan) return showScreen('picker');

  showScreen('mode', plan.mode);

  if (plan.mode === 'freeze_rescue') {
    if (direction !== 0) {
      // MICRO_STEPS is ordered hardest (tier 0) -> easiest (last tier), the
      // opposite of "difficulty", so invert before applying the direction.
      const maxTier = MICRO_STEPS.length - 1;
      const difficulty = maxTier - (plan._stepTier ?? 0);
      const nextDifficulty = Math.min(Math.max(difficulty + direction, 0), maxTier);
      plan._stepTier = maxTier - nextDifficulty;
    }
    executeAction(plan);
    return;
  }

  // A sprint actually ran under this plan if _lastMinutes is set — true for
  // every focus_sprint plan, AND for wobbly's soft_recovery "test the
  // water" 5-min dip (startSprint doesn't care what plan.mode says). Key
  // off that, not plan.mode, or the dip silently retries as plain rest.
  if (plan._lastMinutes != null) {
    const current = plan._lastMinutes;
    if (direction === 0) {
      startSprint(plan, current);
      return;
    }
    const idx = SPRINT_CHOICES.indexOf(current); // -1 for the 5-min dip
    if (direction > 0) {
      startSprint(plan, SPRINT_CHOICES[idx === -1 ? 0 : Math.min(idx + 1, SPRINT_CHOICES.length - 1)]);
      return;
    }
    // softer: step down the real ladder; the 5-min dip is already the
    // floor, so softer than that is rest, not a shorter timer.
    if (idx > 0) {
      startSprint(plan, SPRINT_CHOICES[idx - 1]);
      return;
    }
    executeAction(plan);
    return;
  }

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
    activeSprintPlan = null;
  });
}

function showHyperfocusBanner() {
  hyperfocusBanner.hidden = false;
}

/* ------------------------------------------------------------------ */
// State routing — explicit picks go straight to a mode; passive signals
// get a gentle confirm overlay first (build trust before assuming control).
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

/* ------------------------------------------------------------------ */
// Init
initStatePicker();
initTaskPanel();
initDebrief();
initHyperfocusBanner();
signalEngine.start();

// Log ready
console.log('🧠 Hyperfocus Co-Pilot v1 loaded');
console.log('Engines:', { signalEngine, interventionRouter, memoryEngine });
