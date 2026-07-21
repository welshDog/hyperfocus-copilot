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
                        │  Mode Renderer   │     │  localStorage   │
                        │  (DOM updates)   │     │  + Supabase     │
                        └──────────────────┘     └─────────────────┘
```

## Event Flow

1. **Passive:** User is idle → `SignalEngine` emits `state-detected` → `InterventionRouter` confirms (v1) or routes → `ModeRenderer` updates DOM.
2. **Active:** User taps state → `SignalEngine.reportExplicit()` → same flow.
3. **Outcome:** User completes/bails → `MemoryEngine.record()` → stored locally + synced.

## Why no framework?

Load time is a feature. A frozen user needs the app in < 1s, not after a JS bundle parse. We use:
- CustomEvent for cross-engine communication
- CSS custom properties for instant theme switching
- Web Components not needed until v2

## Future (post-v1)

- Replace in-memory event bus with BroadcastChannel for multi-tab sync
- Add WebRTC data channel for async body-double presence
- ML state prediction via simple on-device model (TensorFlow.js or Transformers.js)
