---
name: vibecode-core
description: Architecture, invariants, JXA pitfalls and verification of the VibeCode base app in core/ — the main window, saved workspaces, Desktop shortcuts (Finder aliases) and the module.json registry. Use when changing core/, a module.json, VibeCode.command, the launcher's --project / --list-projects flags, or when shortcuts, aliases or the main window misbehave.
---

# VibeCode base app (`core/`)

`VibeCode.command` (a six-line forwarder, like the other starters) → `core/vibecode.py`.
No arguments opens the window, otherwise it is a command line. Stdlib Python only (3.9 is
enough: no `match`, no `X | Y` types).

| Thing | Path |
|-------|------|
| Logic + CLI | `core/vibecode.py` |
| Main window (JXA/AppKit) | `core/window.js` |
| Module registry | `*/module.json` (`entries`: `id`, `title`, `run`, `menu`; `{module}` = module dir) |
| Saved workspaces (user data) | `~/.config/vibecode-workspace/workspaces.json` |
| Generated starters / repo path | `~/.config/vibecode-workspace/shortcuts/`, `.../home` |
| Tests | `tests/test_core.py`, `tests/core-window.test.js`, `tests/launcher-projects.test.js` |

## How a Desktop shortcut works

1. The workspace stores project **names** (not paths — paths change, see the `~/Documents/GitHub`
   → `~/nosync/Github` move) and `shortcut: true`.
2. Saving writes a starter `shortcuts/<slug>-<hash>.command` and a **Finder alias** to it on the
   Desktop, named like the workspace.
3. Double-click → alias resolves to the starter → starter reads `~/.config/.../home` (the repo
   path, refreshed on every app start, so a moved repo only needs one app start) → `vibecode.py
   run NAME` → `workspaces/VibeCode Workspace.command --project A --project B`.

`--list-projects` exists so the window shows exactly the list the launcher shows, including
auto-discovered sibling repos. Do not re-implement discovery in Python.

## Invariants (each has a test — keep them meaningful)

- **Never touch a foreign Desktop file.** Create refuses, delete leaves it alone. Only an alias
  that resolves to *our* starter, or a dead alias of that exact name, is ours.
- **Alias/shortcut first, store second.** If creating the alias fails, `workspaces.json` stays unchanged.
- **Corrupt `workspaces.json` / `module.json` raise**, they are never replaced by "empty" (same rule as
  pitfall 9 of the launcher skill).
- **Names are validated** (no `/ \ :`, no control chars, no leading dot, ≤ 60) and compared case-insensitively.
- **Names reach the shell only quoted** (`shlex.quote` in the starter, `shellQuote` + `--name=` in the
  window, so a name like `-x` is not read as an option) and reach AppleScript only as `argv`.
- **`--project` does not touch `last-selection.txt`**: "last used" belongs to the selection dialog.
- **Handled launcher errors set `HANDLED_ERROR=true`** before `exit 1`. The EXIT trap otherwise shows a
  second, generic alert ("konnte nicht gestartet werden") on top of the specific one.
- Tests must never touch `~/.config` or the real Desktop: they set `VIBECODE_CONFIG_DIR` and
  `VIBECODE_DESKTOP_DIR`. Keep it that way.

## JXA pitfalls found while building this (each cost a failed run)

- **Nil for object parameters is `$()`, not `null`.** `null` arrives as `NSNull` and crashes with
  `-[NSNull _cfurl]: unrecognized selector`. (`null` is fine for the `error:` out-parameters.)
- **NSInteger values and AppKit constants are JavaScript strings** (`$.NSAlertFirstButtonReturn` is
  `"1000"`, `+ 1` gives `"10001"`, `alert.buttons.count` is a string). `===` between a number and a
  constant is false. Always compare with `Number(...)` (`isButton()` in `window.js`).
- `osascript -l JavaScript -e '<script>' a b c` passes `a b c` to `run(argv)`.
- Finder aliases are made with `NSURL` bookmark data (`NSURLBookmarkCreationSuitableForBookmarkFile`
  + `writeBookmarkData…`): no Finder automation prompt, they follow a moved target, and
  `URLByResolvingAliasFileAtURL…` plus `NSURLIsAliasFileKey` tell alias / other / dead apart.
- In **zsh, `path` is tied to `PATH`**: `read -r name path` silently breaks every later command
  (`command not found: basename`). Never use it as a variable name.

## Testing

```bash
node --test tests/*.test.js
python3 -m unittest tests.test_remote tests.test_core
```

`tests/test_local_dev.py` has 3 failing tests on a clean checkout; they are unrelated.
Widget tests build the real `NSAlert` views and replace only `present()`, the one place that shows a
window — keep it that single hook.

## Verified vs. not verified

Verified: alias create/inspect/resolve/replace/remove against real aliases in a temp dir; the whole
launcher with `--project` / `--list-projects` / missing projects; window flow and real widgets with
scripted answers; the real `doShellScript` round trip with umlauts, quotes and `&`; the app with
`remote/` and `local-dev/` removed.

**Not verified** (needs a person at the screen): how the windows *look*, clicking through them, the
first-time macOS prompt for Desktop access, and that a Desktop double-click starts the launcher.
Closing the window leaves the Terminal tab that `VibeCode.command` opened (the launcher closes its own;
the app does not yet). A `.app` wrapper would avoid the Terminal altogether.
