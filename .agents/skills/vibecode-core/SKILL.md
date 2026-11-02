---
name: vibecode-core
description: Architecture, invariants, JXA pitfalls and verification of the VibeCode base app in core/ — the main window, saved workspaces, Desktop shortcuts (Finder aliases) and the module.json registry. Use when changing core/, a module.json, VibeCode Workspace.command, the launcher's --project / --list-projects flags, or when shortcuts, aliases or the main window misbehave.
---

# VibeCode base app (`core/`)

`VibeCode Workspace.command` in the repo root (a short forwarder) → `core/vibecode.py`. It is **not** the launcher of
the same name in `workspaces/`; that one is reached through the window (`launch`).
No arguments opens the window, otherwise it is a command line. Stdlib Python only (3.9 is
enough: no `match`, no `X | Y` types).

| Thing | Path |
|-------|------|
| Logic + CLI | `core/vibecode.py` |
| Overview window (JXA/AppKit) | `core/window.js` |
| Module registry | `*/module.json` (`entries`: `id`, `title`, `run`, `menu`, optional `order` and `status`; `{module}` = module dir) |
| Saved workspaces (user data) | `~/.config/vibecode-workspace/workspaces.json` |
| Generated starters / repo path | `~/.config/vibecode-workspace/shortcuts/`, `.../home` |
| Tests | `tests/test_core.py`, `tests/core-window.test.js`, `tests/launcher-projects.test.js`, `tests/presets.test.js`, `tests/test_local_folders.py` |

## How a Desktop shortcut works

1. The workspace stores project **names** (not paths — paths change, see the `~/Documents/GitHub`
   → `~/Projects` move) and `shortcut: true`.
2. Saving writes a starter `shortcuts/<slug>-<hash>.command` and a **Finder alias** to it on the
   Desktop, named like the workspace.
3. Double-click → alias resolves to the starter → starter reads `~/.config/.../home` (the repo
   path, refreshed on every app start, so a moved repo only needs one app start) → `vibecode.py
   run NAME` → `workspaces/VibeCode Workspace.command --project A --project B`.

`--list-projects` exists so the window shows exactly the list the launcher shows, including
auto-discovered sibling repos. Do not re-implement discovery in Python.

## The overview window

One real `NSWindow` (not an `NSAlert`) with sections **Workspaces**, **Repository-Suche**, **Presets pro Repository**, **SSH**,
**Projekte & Module** (a section only appears if its module offers it). Every row shows
its status (a coloured dot: green ok, orange warn, grey off) and has its own buttons, so nothing is hidden behind a menu.
The dialogs for editing a workspace, entering a pasted line and confirming a key are still `NSAlert`s.

- **Model and rendering are separate.** `dashboardModel(state)` returns plain rows (`title`, `section`, `item`, `note`,
  `footer`) and is tested as data; `buildDashboard(rows)` makes the views. `perform()` / `flow()` turn the chosen action
  into backend calls and are tested with a scripted UI.
- **Buttons need a target.** `ObjC.registerSubclass` defines `VibeWorkspaceHandler` (`act:` and `windowWillClose:`); the
  result lands in `dashboardAction` and the handler calls `stopModalWithCode`. `presentDashboard()` is the single place
  that shows the window (tests replace it, like `present()` for alerts). Verified with a timer clicking inside the real modal loop.
- **Status comes from the modules.** An entry's optional `status` is a command that prints one JSON line
  `{"text", "level": ok|warn|off}`; `entry_status()` runs them in parallel, a broken one becomes a visible warning, never a
  broken window. `order` (smaller = higher) sorts the rows. Producers: launcher `--summary`, `remote.py summary`,
  `local-dev/summary.py`.
- **The overview must never contact SSH hosts.** The launcher scans hosts live unless the flag is in its `--cached` list
  (`--check`, `--list-projects`, `--summary`). Adding another read-only flag without adding it there makes every window
  open wait on every unreachable host (5 s each). `tests/launcher-projects.test.js` pins this.
- **The window grows with the screen** (`maxContent()`, 420 to 780) so the buttons at the end of a section are not behind a
  scroll. Notes and titles truncate visibly (with `…` and a tooltip); paths truncate in the **middle** so the folder name stays.
- **To look at the layout without showing a window:** render `window.contentView.superview` (the frame view) with
  `bitmapImageRepForCachingDisplayInRect` + `cacheDisplayInRectToBitmapImageRep` into a PNG and read it. Rendering the
  *content view* alone comes out blank.

## Search folders and presets (workspaces module, driven from the window)

**Search folders.** `workspaces/local-folders.py` is the local counterpart of `remote-hosts.py`: `add|remove|list|discover`
over `~/.config/vibecode-workspace/search-folders.json` (same rules: corrupt file raises and is never overwritten, atomic
writes). The launcher calls `discover` on every start. Rules live in one place (`find_repos`: depth 4, prune list, hidden
and symlinked folders skipped, a found repo is not searched further, `MAX_DIRS` cutoff reported as `truncated`). The core
never re-implements the scan: `folder_state()` asks the module, `folder_action()` wraps add/remove/add-remote/remove-remote.
Adding a remote folder runs `discover` **without** `--interactive` and keeps the host even if the search fails.

**Presets.** `workspaces/presets.js` reads and writes `terminals.json` (the wizard's file, v1 read / v2 written). It loads
`terminalCommand`, `defaultTerminals`, `validateTerminals`, `validateUrls`, `normalizeEntry` **from `terminal-setup.js`'s own
source** (`new Function`), so the command building and its shell quoting exist once. The window sends only type, name, prompt
and cwd; the `command` is derived. Presets are keyed by the project **path as the launcher resolves it** (`--list-paths`),
which is why a moved repo orphans its preset; `presets_state()` surfaces those with a unique same-name suggestion and
`move` copies first, deletes second. `presets.js` is stricter than the wizard on purpose (http/https tabs, unique names,
at most 12 terminals) and creates the config directory on a fresh Mac.

Pitfall that bit once: in `state()` a second variable called `projects` silently replaced the names list with tuples. Names are
now derived from `list_project_paths()`, one launcher call instead of two.

## SSH in the window

`ssh_state()` merges `hosts list` (workspaces module: `remote-hosts.json` plus the repository cache, **no** SSH
connection) and `remote ssh show` (the saved Mac target). `available` is true if any of the hosts, remote or setup
modules is present, so a removed module only hides what it provided.

- The window may trigger **only** `SSH_ACTIONS` (`share`, `share-wake`, `join`, `allow-check`, `allow`) through
  `vibecode.py _ssh ACTION --line=…`. It always answers `{code, out, err}` and never raises on exit codes:
  **`join` exit 2 means "not authorized yet" and is not an error.** Do not add a generic "run any command" path.
- Pasted lines are parsed in Python (`line_tokens`: `shlex`, then every `--option` is dropped) and validated again
  by `remote.py`. `allow` goes through `allow --check` (name + fingerprint as JSON, writes nothing) and an explicit
  confirmation in the window before `allow --yes`.
- `ssh-open --kind host|mac|guided` opens Terminal; a host name must be in the configured hosts list, because the name
  comes from the window and must never reach `ssh` unchecked. The guided setup is `Setup … --connect-remote`.
- `join` saves the target *before* probing, so the Mac appears in the list even while it is not yet authorized.
- Tests run the real modules with a fake `HOME` / `VIBECODE_REMOTE_DIR` (`fake_home()`); **never run the real `share`
  in a test**: it opens System Settings and writes the clipboard.

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

- **`window.center` and other no-argument methods are called by property access** (no parentheses), like `alert.runModal`.
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

Verified: the overview rendered offscreen in dark mode (real state and a state with workspaces, hosts and a warning),
real button clicks and the red close box through the real modal loop, alias create/inspect/resolve/replace/remove
against real aliases in a temp dir; the whole
launcher with `--project` / `--list-projects` / missing projects; window flow and real widgets with
scripted answers; the real `doShellScript` round trip with umlauts, quotes and `&`; the app with
`remote/` and `local-dev/` removed.

**Not verified** (needs a person at the screen): light mode, a real mouse click, clicking through every SSH dialog,
opening the Sharing settings pane, a real SSH session started from the window's Terminal, the
first-time macOS prompt for Desktop access, and that a Desktop double-click starts the launcher.
Closing the window leaves the Terminal tab that `VibeCode Workspace.command` opened (the launcher closes its own;
the app does not yet). A `.app` wrapper would avoid the Terminal altogether.
