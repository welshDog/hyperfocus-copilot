# Hyperfocus Co-Pilot

> A nervous-system layer for neurodivergent people. It adapts to your state — not the other way around.

## What this is (30 seconds)

- You open it. It notices if you're stuck.
- It asks: *"You look stuck. Want me to shrink this to two minutes?"*
- One tap. The interface changes, the task gets tiny, and you start.
- It remembers what worked last time and offers that first.

## Quick start (copy-paste)

```bash
git clone https://github.com/yourname/hyperfocus-copilot.git
cd hyperfocus-copilot
# No install step. Open public/index.html in a browser.
# Or serve locally:
npx serve public
```

## Tech

- Vanilla JS. No build tools. Loads in < 1s.
- PWA — works offline.
- Supabase for memory sync (optional for local-only use).
- Web Speech API for voice (free, offline).

## V1 scope

- [ ] State picker (6 states)
- [ ] Freeze Rescue mode (the hero)
- [ ] Focus Sprint mode
- [ ] Soft Recovery mode
- [ ] Adaptive UI (changes with your state)
- [ ] Momentum Memory (remembers what worked)
- [ ] Debrief (did this help?)

See `docs/PRD.md` for full spec.

## Why no React / build step?

Speed of load matters more than DX for this product. An ADHD user opening the app while frozen needs it to appear *now*, not after a 3-second JS bundle download. We can add a build step in v2 if needed.

## Contributing

Not accepting PRs until v1 ships. Issues and ideas welcome.

## License

MIT
