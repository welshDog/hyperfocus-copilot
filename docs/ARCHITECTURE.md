# Architecture Overview

## Three-Engine Design

All v1 functionality routes through three engines. No UI component talks directly to another.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Signal Engine  │────▶│ Intervention     │────▶│  Memory Engine  │
│  (detect state) │     │ Router           │     │  (store/recall) │
└─────────────────┘     │ (pick mode + UI) │     └─────────────────┘
                        └──────────────────┘              │
                                │                         │
                                ▼                         ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │  app.js render   │     │  localStorage   │
                        │  fns (DOM)       │     │  (v1 only)      │
                        └──────────────────┘     └─────────────────┘
```

> No separate "Mode Renderer" module exists — `renderMode()` / `executeAction()`
> in `app.js` do this inline. Memory is localStorage-only in v1; Supabase sync
> is unbuilt (tracked as v2 in the PRD), so nothing is "synced" yet.

## Event Flow

1. **Passive:** User is idle → `SignalEngine` emits `state-detected` → `InterventionRouter` confirms (v1) or routes → `app.js` re-renders the mode screen.
2. **Active:** User taps state → `SignalEngine.reportExplicit()` → same flow.
3. **Outcome:** User completes/bails → `MemoryEngine.record()` → written to localStorage.

## Why no framework?

Load time is a feature. A frozen user needs the app in < 1s, not after a JS bundle parse. We use:
- CustomEvent for cross-engine communication
- CSS custom properties for instant theme switching
- Web Components not needed until v2

## Future (post-v1)

- Replace in-memory event bus with BroadcastChannel for multi-tab sync
- Add WebRTC data channel for async body-double presence
- ML state prediction via simple on-device model (TensorFlow.js or Transformers.js)
