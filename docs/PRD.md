# Hyperfocus Co-Pilot — v1 Product Spec

> **The product adapts to your nervous system. Not the other way around.**

## 1. Product Definition (One Sentence)

A PWA that detects when a neurodivergent user is stuck, overwhelmed, or depleted — then automatically reshapes the interface, support tone, and next action to match their current state, while remembering what actually worked for them last time.

## 2. The Killer Moment

The user is staring at a task, not moving. After 90 seconds of inactivity, the app gently surfaces:

> *"You look stuck. Want me to shrink this to two minutes?"*

One tap. The task becomes absurdly small. The UI softens. A warm voice (optional) reads the single micro-step aloud. The barrier to entry drops from Everest to a curb.

## 3. Internal Architecture: Three Engines

Everything in v1 plugs into one of these three engines. No feature exists without a clear engine owner.

### 3.1 Signal Detection Engine

**Job:** Infer the user's cognitive/emotional state from behavior signals and self-reporting.

**Inputs:**
| Signal | Source | Confidence |
|--------|--------|------------|
| Time since last interaction | DOM events / visibility API | High |
| Tab switching frequency | `window.onblur/onfocus` | Medium |
| Typing cadence (if applicable) | Input event timestamps | Medium |
| Scroll patterns | Scroll event debounce | Low-Medium |
| Explicit state pick | User tap | High |
| Time of day / session history | Local timestamp + memory | Medium |

**Output:** `DetectedState` object
```typescript
interface DetectedState {
  label: 'overwhelmed' | 'frozen' | 'hyperfocus' | 'burnt_out' | 'wobbly' | 'sprint_ready';
  confidence: number;        // 0.0 - 1.0
  source: 'signal' | 'explicit' | 'predicted';
  timestamp: number;
  contextSnapshot: {
    timeOfDay: string;       // "morning" | "afternoon" | "evening" | "night"
    sessionDurationMinutes: number;
    lastMode: string;
    consecutiveFrozenChecks: number;
  };
}
```

**v1 Rule:** Manual picker is the fallback. Passive signals trigger gentle confirmations ("You seem stuck — right?") rather than auto-switching. Build trust before assuming control.

### 3.2 Intervention Routing Engine

**Job:** Given a detected state, select the exact support mode, UI profile, tone, and micro-action.

**State → Mode Map (v1):**

| State | Primary Mode | UI Profile | Tone | First Action |
|-------|-------------|------------|------|--------------|
| frozen | `freeze_rescue` | Chunky buttons, muted palette, low motion, max contrast option | Gentle, patient, zero pressure | Generate one 2-minute micro-step |
| overwhelmed | `freeze_rescue` | Same as frozen + reduced text density | Same | List collapse: hide everything except one thing |
| sprint_ready | `focus_sprint` | Minimal chrome, dark/clean, no animations | Quiet, efficient, gets out of the way | Start 25-min session with task pre-loaded |
| hyperfocus | `focus_sprint` | Same + break nudges only | Same | Continue tracking, nudge at 90min |
| burnt_out | `soft_recovery` | No tasks visible, soft pastels, breathing space | Warm, validating, no goals | Ambient sound + "rest is the task" |
| wobbly | `soft_recovery` | Soft, but task list peekable | Encouraging, light | Suggest 5-min "test the water" sprint |

**Output:** `InterventionPlan`
```typescript
interface InterventionPlan {
  mode: 'freeze_rescue' | 'focus_sprint' | 'soft_recovery';
  uiProfile: UIProfile;
  tone: 'gentle' | 'quiet' | 'warm' | 'encouraging';
  suggestedAction: MicroAction;
  autoTrigger: boolean;      // false in v1; true only after user opts in
}
```

### 3.3 Memory Recall Engine

**Job:** Store and retrieve what interventions worked, in what context, for this specific user.

**Core Query:** "Last time I was [state] at [time/context], what helped?"

**Schema (see `supabase/migrations/001_initial_schema.sql` for full SQL):**

| Table | Purpose |
|-------|---------|
| `state_sessions` | Each detected state + intervention + outcome |
| `intervention_patterns` | Aggregated "what worked when" |
| `user_profiles` | Baseline preferences, spoon budget, energy patterns |

**Key Memory Query (pseudocode):**
```
Given: current state S, current context C
Find: top 3 past sessions where state ≈ S AND context ≈ C AND outcome_score ≥ 4
Return: the intervention used, with a one-line human summary
```

**v1 Scope:** Simple exact-match + time-of-day matching. No ML. Just fast, useful recall.

## 4. v1 Feature Scope (Brutally Tight)

### In Scope
- [ ] State picker (6 states, max 3 taps to help)
- [ ] Passive signal scaffolding (detection code + gentle confirm prompt)
- [ ] Freeze Rescue mode (the hero mode)
- [ ] Focus Sprint mode (timer + minimal UI)
- [ ] Soft Recovery mode (rest-first, no tasks)
- [ ] Adaptive UI engine (font, contrast, motion, button size per mode)
- [ ] Momentum Memory storage + basic recall
- [ ] Debrief screen (Did this help? yes/kinda/no)
- [ ] PWA shell (offline capable, installable)
- [x] One integration: pull tasks from a simple text list / localStorage
      (`js/engines/task-list.js`, key `hfc_tasks_v1`. Supabase `tasks` sync is v2.)

### Out of Scope (v1)
- Live body-double rooms (async only)
- AI voice generation (use Web Speech API for MVP)
- Native app wrappers
- Complex third-party integrations (Notion, Todoist, etc.)
- ML-based state prediction
- Spoon theory budget tracking (UI placeholder only)
- Social features beyond async encouragement

## 5. User Flows

### Flow A: Freeze Rescue (The Hero Flow)

```
User opens app / returns to tab
  └─> Signal engine notices 90s inactivity
        └─> Gentle overlay: "You look stuck. Want me to shrink this to two minutes?"
              ├─ [Yes] → Intervention engine loads Freeze Rescue
              │           └─> UI shifts: chunky buttons, muted colors
              │           └─> Task auto-selected from top of list
              │           └─> Broken into 2-minute micro-step
              │           └─> Optional: TTS reads step aloud
              │           └─> User completes or bails
              │           └─> Debrief screen
              │           └─> Result saved to Memory
              │
              ├─ [Not stuck] → Dismiss, return to previous state
              │
              └─ [Pick different state] → Show state picker
```

### Flow B: Focus Sprint

```
User selects "Ready to sprint" or signal detects sustained engagement
  └─> Load Focus Sprint mode
        └─> Minimal UI, task pre-loaded
        └─> 25-min timer (configurable)
        └─> Break nudge at 25min, hard nudge at 90min
        └─> Debrief on completion / cancel
```

### Flow C: Soft Recovery

```
User selects "Burnt out" or signal predicts depletion
  └─> Load Soft Recovery mode
        └─> All tasks hidden
        └─> Ambient sound player (looping soft audio)
        └─> "Rest is the task right now" messaging
        └─> Optional: log what drained you (saves to memory)
        └─> Exit to state picker when ready
```

## 6. UI / UX Requirements

### Universal Rules
- **No dead ends:** Every screen has an exit, a back, and a "just get me out" gesture.
- **Max 3 taps to help:** From app open to receiving support.
- **Respect `prefers-reduced-motion`:** All animations gated by this media query.
- **Offline-first:** Core state picker and modes work without network. Sync to Supabase when available.
- **No guilt language:** Never "You should...", always "You could..." or "Want to try...?"

### Mode-Specific UI Profiles

#### Freeze Rescue
- Button min-height: 64px (fat finger friendly)
- Font: system-ui, weight 500+, size 18px+
- Colors: muted warm grays, soft amber accents
- Motion: none or 300ms fade only
- Layout: single column, max 2 actions visible

#### Focus Sprint
- Button min-height: 44px
- Font: system-ui, weight 400, size 16px
- Colors: deep slate, minimal accent
- Motion: timer pulse only
- Layout: centered timer, task below, controls minimal

#### Soft Recovery
- No buttons above fold except "exit recovery"
- Font: system-ui, weight 400, size 16px
- Colors: soft pastels, warm cream backgrounds
- Motion: slow ambient gradients (optional)
- Layout: centered message, ambient player, gentle prompts

## 7. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Vanilla JS + Web Components | Zero build step for v1, instant load, PWA-friendly |
| State Management | Custom event bus (`AppBus`) | Lightweight, no dependencies, ADHD-brain simple |
| Styling | CSS custom properties (theming) + adaptive classes | Mode switches by swapping `data-mode` attribute |
| Storage | localStorage (offline) + Supabase (sync) | Works without net, syncs when available |
| TTS | Web Speech API (`speechSynthesis`) | Free, offline, no API keys |
| Hosting | GitHub Pages or Vercel | Free, fast, zero config |
| Backend | None for v1 (use Supabase directly) | Ship faster, add API later if needed |

## 8. Data Model (Supabase)

See `supabase/migrations/001_initial_schema.sql` for executable SQL.

Key tables:
- `profiles` — one row per user (auth trigger)
- `state_sessions` — every state detection + intervention + outcome
- `interventions` — catalog of available interventions per mode
- `tasks` — user's task list (local-first, sync to Supabase)

## 9. Success Metrics (v1)

| Metric | Target | Why |
|--------|--------|-----|
| Time-to-help | < 10 seconds | From app open to seeing a support action |
| Freeze rescue completion rate | > 40% | Users who start a micro-step finish it |
| Debrief response rate | > 60% | Users tell us what worked |
| Return within 24h | > 30% | Did it actually help enough to come back? |
| Offline usage | > 20% | PWA is working, not just a web page |

## 10. Sprint Plan (Revised)

### Week 1 — Freeze Rescue + State Engine
- Day 1: Scaffold repo, PWA shell, manifest, service worker
- Day 2: Build state picker (6 emoji buttons → console.log)
- Day 3–4: Signal detection scaffold (inactivity timer, tab blur detection)
- Day 5–6: Build Freeze Rescue mode (micro-step generator, chunky UI, TTS)
- Day 7: Rest + test. Does stuck-detection feel helpful, not creepy?

### Week 2 — Adaptive UI + Focus Sprint
- Day 8–10: Adaptive UI engine (CSS custom property swap per mode)
- Day 11–13: Focus Sprint mode (timer, minimal UI, break nudges)
- Day 14: Polish transitions. No jarring mode switches.

### Week 3 — Momentum Memory
- Day 15–17: Supabase schema + localStorage mirror
- Day 18–20: Memory recall engine ("Last time you were frozen...")
- Day 21–22: Debrief screen + outcome scoring

### Week 4 — Integration + Ship
- Day 23–25: Task list integration (simple localStorage task array)
- Day 26–27: Ecosystem bridge placeholder (export data shape for Hyperfocus Zone)
- Day 28: Bug bash + performance pass
- Day 29: Record 60-second demo
- Day 30: Ship to GitHub, post to Discord

## 11. File Structure

```
hyperfocus-copilot/
├── docs/
│   ├── PRD.md                    # This document
│   └── ARCHITECTURE.md           # Engine internals (after v1)
├── public/
│   ├── index.html                # PWA entry point, state picker
│   ├── manifest.json             # PWA manifest
│   ├── sw.js                     # Service worker (offline support)
│   ├── css/
│   │   ├── base.css              # Reset + tokens
│   │   ├── modes.css             # Mode-specific overrides
│   │   └── adaptive.css          # Dynamic theming engine
│   └── js/
│       ├── app.js                # Entry point, AppBus
│       ├── engines/
│       │   ├── signal-detection.js
│       │   ├── intervention-router.js
│       │   └── memory-recall.js
│       ├── modes/
│       │   ├── freeze-rescue.js
│       │   ├── focus-sprint.js
│       │   └── soft-recovery.js
│       ├── components/
│       │   ├── state-picker.js
│       │   ├── debrief-screen.js
│       │   └── task-list.js
│       └── utils/
│           ├── storage.js        # localStorage + Supabase sync
│           ├── tts.js            # Web Speech API wrapper
│           └── dom.js            # DOM helpers
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
└── README.md
```

## 12. Open Questions (Decide by Day 3)

1. **Auth:** Anonymous auth (Supabase) vs. no auth for v1? → *Decision: Anonymous auth. We need user IDs for memory.*
2. **Task source:** Build minimal task list or integrate with Apple Reminders/Notion? → *Decision: Simple localStorage task array for v1.*
3. **Signal threshold:** 90 seconds of inactivity for stuck detection — too aggressive? → *Decision: Start at 90s, make user-configurable.*
4. **Voice:** Web Speech API only, or prepare for ElevenLabs later? → *Decision: Web Speech API for v1. Warm prompt copy matters more than voice quality.*

---

**Status:** DRAFT v1.0  
**Last updated:** 2026-07-21  
**Next review:** After Day 7 (end of Week 1)
