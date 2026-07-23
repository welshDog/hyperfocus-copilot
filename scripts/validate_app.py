#!/usr/bin/env python
"""HyperFocus Z0ne -- hyperfocus-copilot pre-push eval gate.

This repo has NO build step on purpose (a frozen ADHD user needs the app to
appear *now*, not after a bundle download). That means nothing stands between
a typo and a white screen for real users -- so the gate does the job a build
would otherwise do:

  1. syntax   -- every ES module under public/js parses
  2. sw       -- the service-worker ASSETS list matches what's on disk
  3. cache    -- CACHE_NAME was bumped whenever ASSETS changed
  4. residue  -- no debug/test leftovers shipped

Run:      python scripts/validate_app.py
Override: git push --no-verify   (emergency only)
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Windows consoles are cp1252; printing anything non-ASCII crashes without this.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "public"
SW = PUBLIC / "sw.js"

# Debug leftovers that must never reach users. `console.log` is deliberately
# allowed -- app.js uses it for a boot banner.
RESIDUE = ("TEMP-TEST", "debugger;")

errors: list[str] = []
warnings: list[str] = []


def rel(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


# --------------------------------------------------------------------------
# 1. Syntax
# --------------------------------------------------------------------------
def check_syntax() -> None:
    """Parse every module.

    TRAP: `node --check foo.js` SILENTLY EXITS 0 on a file containing `import`
    -- it detects module syntax and gives up rather than reporting an error.
    Verified on Node v22: a blatantly broken file passes as .js and fails as
    .mjs. So each module is copied to a temp .mjs before checking. Do not
    "simplify" this back to a direct --check on the .js path; the gate would
    pass forever and catch nothing.
    """
    node = shutil.which("node")
    if not node:
        warnings.append("node not found -- syntax check SKIPPED (install Node to arm it)")
        return

    modules = sorted(PUBLIC.glob("js/**/*.js"))
    if not modules:
        errors.append("no JS modules found under public/js -- is the repo intact?")
        return

    with tempfile.TemporaryDirectory() as tmp:
        for mod in modules:
            shim = Path(tmp) / (mod.stem + ".mjs")
            shim.write_text(mod.read_text(encoding="utf-8"), encoding="utf-8")
            proc = subprocess.run(
                [node, "--check", str(shim)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip().splitlines()
                snippet = " | ".join(line.strip() for line in detail[:4] if line.strip())
                errors.append(f"syntax error in {rel(mod)}: {snippet}")

    print(f"[syntax]  checked {len(modules)} module(s)")


# --------------------------------------------------------------------------
# 2 + 3. Service worker
# --------------------------------------------------------------------------
def parse_assets(source: str) -> list[str]:
    match = re.search(r"const\s+ASSETS\s*=\s*\[(.*?)\]", source, re.S)
    if not match:
        return []
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def parse_cache_name(source: str) -> str | None:
    match = re.search(r"const\s+CACHE_NAME\s*=\s*['\"]([^'\"]+)['\"]", source)
    return match.group(1) if match else None


def check_service_worker() -> str | None:
    """Every shipped asset must be precached, and every precached path must exist.

    A module missing from ASSETS breaks the app offline -- which is the one
    moment this app most needs to work.
    """
    if not SW.exists():
        errors.append("public/sw.js is missing")
        return None

    source = SW.read_text(encoding="utf-8")
    assets = parse_assets(source)
    cache_name = parse_cache_name(source)

    if not assets:
        errors.append("could not parse ASSETS from sw.js")
    if not cache_name:
        errors.append("could not parse CACHE_NAME from sw.js")

    listed = {a for a in assets if a != "/"}

    # Everything on disk that the app actually loads.
    on_disk = {
        "/" + p.relative_to(PUBLIC).as_posix()
        for p in PUBLIC.rglob("*")
        if p.is_file() and p.suffix in {".js", ".css"} and p.name != "sw.js"
    }

    for missing in sorted(on_disk - listed):
        errors.append(f"{missing} exists but is NOT in sw.js ASSETS (breaks offline)")

    for ghost in sorted(listed - on_disk):
        if not (PUBLIC / ghost.lstrip("/")).exists():
            errors.append(f"sw.js ASSETS lists {ghost} but no such file exists")

    print(f"[sw]      {len(assets)} asset(s) listed, cache '{cache_name}'")
    return cache_name


def check_cache_bump(cache_name: str | None) -> None:
    """If ASSETS changed since the last pushed commit, CACHE_NAME must change too.

    activate() purges caches whose name != CACHE_NAME. Change the asset list
    without renaming the cache and returning users keep the stale bundle --
    the exact class of bug that froze every v1 user on their first version.
    """
    if not cache_name:
        return

    for ref in ("origin/main", "HEAD"):
        proc = subprocess.run(
            ["git", "show", f"{ref}:public/sw.js"],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if proc.returncode == 0:
            previous = proc.stdout
            break
    else:
        warnings.append("no git baseline for sw.js -- cache-bump check skipped")
        return

    if parse_assets(previous) != parse_assets(SW.read_text(encoding="utf-8")):
        if parse_cache_name(previous) == cache_name:
            errors.append(
                f"ASSETS changed but CACHE_NAME is still '{cache_name}' -- "
                "bump it or returning users keep the stale app"
            )
        else:
            print("[cache]   ASSETS changed and CACHE_NAME was bumped")
    else:
        print("[cache]   ASSETS unchanged")


# --------------------------------------------------------------------------
# 4. Residue
# --------------------------------------------------------------------------
def check_residue() -> None:
    scanned = 0
    for path in sorted(PUBLIC.rglob("*")):
        if not path.is_file() or path.suffix not in {".js", ".css", ".html"}:
            continue
        scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), 1):
            for marker in RESIDUE:
                if marker in line:
                    errors.append(f"{rel(path)}:{line_no} contains '{marker}'")
    print(f"[residue] scanned {scanned} file(s)")


# --------------------------------------------------------------------------
def main() -> int:
    print("[copilot-eval] validating hyperfocus-copilot ...")

    if not PUBLIC.is_dir():
        print(f"[copilot-eval] FAIL -- {PUBLIC} not found")
        return 1

    check_syntax()
    cache_name = check_service_worker()
    check_cache_bump(cache_name)
    check_residue()

    for warning in warnings:
        print(f"[warn]    {warning}")

    if errors:
        print("")
        print(f"[copilot-eval] FAIL -- {len(errors)} problem(s):")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("")
    print("[copilot-eval] OK -- app is shippable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
