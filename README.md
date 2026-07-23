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

- [x] State picker (6 states)
- [x] Freeze Rescue mode (the hero)
- [x] Focus Sprint mode
- [x] Soft Recovery mode
- [x] Adaptive UI (changes with your state)
- [x] Momentum Memory (remembers what worked)
- [x] Debrief (did this help?)
- [x] Task list (localStorage) — the task the copilot commits to

## The task list

The copilot always commits to **one** task: the top of your list.

- Add tasks on the picker screen (collapsed by default — the state picker stays the hero).
- `⬆` promotes any task to the top. No drag-and-drop: fiddly targets are exactly
  what a frozen brain can't do.
- **Freeze Rescue** shrinks the top task into a micro-step. Tapping *"still too big"*
  escalates to a genuinely smaller step each time, down to "sit and look at the screen".
- **Focus Sprint** locks the top task in for 25 minutes, then offers to tick it off.
- **Soft Recovery** hides tasks entirely. Rest is the task.

If your list is empty the copy says so — it never claims to have "picked your top task"
when there isn't one.

See `docs/PRD.md` for full spec.

## Pre-push gate

There's no build step, so nothing else stands between a typo and a white screen.
`scripts/validate_app.py` does that job instead:

| Check | Blocks the push when… |
|---|---|
| syntax | any module under `public/js` fails to parse |
| sw | a shipped `.js`/`.css` is missing from `sw.js` ASSETS, or ASSETS lists a file that doesn't exist |
| cache | ASSETS changed but `CACHE_NAME` wasn't bumped (returning users would keep the stale app) |
| residue | `TEMP-TEST` or `debugger;` reached a shipped file |

```bash
python scripts/validate_app.py           # run it any time
cp scripts/git_hooks/pre-push .git/hooks/pre-push   # arm it (re-do after a fresh clone)
git push --no-verify                     # emergency override
```

> 🪤 `node --check foo.js` **silently exits 0** on a file containing `import` — it
> detects module syntax and gives up. The validator copies each module to a temp
> `.mjs` first, where the check actually works. Don't "simplify" that away or the
> gate passes forever while catching nothing.

## Why no React / build step?

Speed of load matters more than DX for this product. An ADHD user opening the app while frozen needs it to appear *now*, not after a 3-second JS bundle download. We can add a build step in v2 if needed.

## Contributing

Not accepting PRs until v1 ships. Issues and ideas welcome.

## License

MIT
