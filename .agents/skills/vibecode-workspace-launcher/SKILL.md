---
name: vibecode-workspace-launcher
description: Known pitfalls, verified fixes and verification commands for the VibeCode Workspace launcher, its terminal/browser-tab configurator, and the auto-open-tabs VS Code extension. Use when changing the launcher scripts, the setup wizard, per-project terminals or auto-opened URLs, or when debugging symptoms like tabs opening as empty files, localhost opening in the system browser, a blank Storybook tab, wrong terminal order, or duplicate VS Code icons in the macOS Dock.
---

# VibeCode Workspace launcher

Hard-won knowledge about this launcher. Every pitfall below was hit for real and the
fix was verified on macOS with VS Code 1.138. Read the relevant section **before**
changing behaviour — several of these look like obvious one-liners and are not.

## Where things live

| Thing | Path |
|-------|------|
| Launcher (source of truth) | `workspaces/VibeCode Workspace.command` |
| Project checkbox dialog (JXA/AppKit) | `workspaces/project-selection.js` |
| Root starters (forwarders) | `Launch Workspace.command`, `Setup Workspace.command` |
| Setup wizard (JXA dialogs) | `workspaces/terminal-setup.js` |
| Auto-open-tabs extension | `workspaces/vscode-extension/auto-open-tabs/` |
| Per-project config (user data) | `~/.config/vibecode-workspace/terminals.json` |
| Generated workspace | `~/.vibe-workspaces/Vibe-Session.code-workspace` |
| Tests | `tests/terminals.test.js` |

## Rules that always apply

- **Never duplicate a starter.** The root `.command` files are six-line forwarders
  (`exec "${0:A:h}/workspaces/..." "$@"`) so the logic exists exactly once. They used to
  be full copies that had to be kept in sync by hand — do not reintroduce that. Desktop
  starters are Finder *aliases*; copying a forwarder to the Desktop breaks it, because it
  resolves the module path relative to its own location.
- **Run the tests after any change:** `node --test tests/terminals.test.js tests/terminal-order.test.js`.
  They drive the real JXA code with scripted dialog answers, so **adding a dialog to the
  wizard breaks every scripted answer array** — update the answers in the tests too.
- Syntax-check shell and embedded JXA before trusting a change:
  ```bash
  zsh -n "workspaces/VibeCode Workspace.command"
  awk '/^osascript -l JavaScript - /{f=1;next} /^JXA$/{f=0} f' \
    "workspaces/VibeCode Workspace.command" > /tmp/jxa.js && node --check /tmp/jxa.js
  ```
- `~/.config/vibecode-workspace/terminals.json` is **user data**, not repo state.
  Changing the default template does not change already-configured projects.
- The launcher uses independent project checkboxes; do not restore the Cmd-dependent
  `choose from list` dialog. An empty JXA result still gives `osascript` a trailing
  newline, so cancellation must check command output rather than file size.
  Otherwise cancelling overwrites the saved selection and workspace with empty lists.
- Terminal startup and split layout come from `vibecodeWorkspace.autoStartTerminals`.
  The extension uses `createTerminal({ location: { parentTerminal: previous } })`
  for a whole group **synchronously, before awaiting any process IDs**. In VS Code
  1.138, parents already opened are serialized as numeric IDs but looked up only by
  their initial extension IDs; awaiting between creations silently produces standalone
  tabs. Commands start directly via `/bin/zsh -l -c`, not `sendText` into an interactive
  shell, which lets Python's environment activation interfere with running agents.
  Each project has its own split group; the control terminal stays separate.
  Disable `python.terminal.activateEnvironment` and
  `python.terminal.activateEnvInCurrentTerminal` in this generated workspace;
  Python activation otherwise types `source .../activate` into agent prompts even
  with a direct shell command. `python-envs.terminal.autoActivationType` is machine-scoped
  and cannot be overridden in a workspace; with no explicit global override, the
  Python Environments extension respects `python.terminal.activateEnvironment`.
  Never replace these splits with standalone tabs or reverse the requested start order.
- VS Code's task runner always splits after the **first** terminal of a task group,
  producing `Frontend, Codex 2, Codex 1, Claude, Storybook` despite correct process start
  order. `presentation.group` is retained for manual tasks, not automatic layout.
  `autoStartTasks` remains a fallback for older workspace files; it waits for
  `onDidStartTaskProcess` because `executeTask()` resolves before actual startup.

## Pitfall 1 — `code <url>` does not open a browser tab

**Symptom:** tabs named `localhost:5173` that are empty text editors showing
"Use Cmd + I to generate code".

`code <url>` treats the URL as a file path and opens an empty untitled editor.
The VS Code CLI has **no `--command` flag** (check `code --help`), so a URL can never be
passed to `simpleBrowser.show` from a shell script. Any approach built on
"just call the CLI with the URL" is a dead end.

## Pitfall 2 — the built-in Simple Browser is a singleton

`simpleBrowser.show` keeps a single `_activeView`; a second call **navigates the existing
tab** instead of opening a second one. Confirmed in
`/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/simple-browser/dist/extension.js`.

So N URLs need N webview panels, which is why `workspaces/vscode-extension/auto-open-tabs`
exists: it creates one `createWebviewPanel` per URL. Do not "simplify" it back onto
`simpleBrowser.show`.

## Pitfall 3 — `allow-popups` in the iframe sandbox leaks to the system browser

**Symptom:** localhost keeps opening in Safari/Chrome over and over.

VS Code forwards popups originating in webview content to the system browser. If the
embedded page calls `window.open()`, an `allow-popups` sandbox lets it escape the editor.
Use exactly the sandbox set the official Simple Browser uses:

```
sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
```

Never add `allow-popups` or `allow-modals`.

## Pitfall 4 — extension changes need the right kind of restart

- **New extension folder** dropped into `~/.vscode/extensions`: needs a **full quit (⌘Q)
  and relaunch**. "Developer: Reload Window" does *not* pick it up.
- **Code change** in an already-known extension: "Developer: Reload Window" is enough.

The launcher builds a local VSIX and installs it into the selected editor with
`--install-extension ... --force` on every run. A copied extension directory can remain
marked uninstalled in `.obsolete` and never activate, even after restarting the editor.
Do not replace the regular installation with raw file copies. Check registration with:

```bash
# "code" is often not on PATH; fall back to the binary inside the app bundle
"$(command -v code || echo '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')" \
  --list-extensions | grep vibecode
```

## Pitfall 5 — VS Code restores stale editor tabs

VS Code persists open editors per workspace and restores them on every reload **and**
after a full restart. Broken tabs from earlier experiments reappear and look like a
current bug. Close them by hand before judging whether a fix worked.

## Pitfall 6 — Storybook opens the system browser by itself

`storybook dev` opens a browser unless `--no-open` is passed. Fix it in the **terminal
command** (`npm run storybook -- --no-open`), not by editing the project's
`package.json` — those repos are shared with the team.

## Pitfall 7 — dev servers start at very different speeds

Vite is ready in ~2s, Storybook takes far longer. An iframe created at editor startup
loads into nothing and stays blank. The extension therefore probes the URL
(1s interval, up to 5 minutes), shows a waiting state, and only then loads the iframe.
Keep that behaviour when touching the extension.

## Pitfall 8 — duplicate VS Code icons in the Dock

**Symptom:** a new VS Code icon appears in the Dock on every launch.

`code <path>` execs the app bundle's binary directly and bypasses LaunchServices, which
registers the app again each time. Diagnose:

```bash
LSREG="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
"$LSREG" -dump | grep -c "Visual Studio Code.app"          # >1 with a single install = duplicates
"$LSREG" -dump | grep -oE "/[^ ]*Visual Studio Code\.app" | sort -u
```

Fix: resolve the `.app` bundle from the CLI path and launch through LaunchServices.
The launcher does this; keep it:

```zsh
EDITOR_BINARY="${${$(command -v "$EDITOR_CMD" 2>/dev/null):-$EDITOR_CMD}:A}"
EDITOR_APP="${EDITOR_BINARY%%.app/*}.app"
[[ -d "$EDITOR_APP" ]] || EDITOR_APP=""
...
open -a "$EDITOR_APP" "$WORKSPACE_PATH"
```

Stale Dock tiles do not disappear on their own; clearing the Dock's recents list removes
them (`defaults write com.apple.dock recent-apps -array && killall Dock`) — ask before
running it, it restarts the Dock.

## Pitfall 9 — normalizers must not swallow invalid data

`terminals.json` is schema v2 — per project `{ "terminals": [...], "urls": [...] }` —
while v1 (a bare terminal array) is still read. The normalizers that bridge both versions
must **pass unknown values through unchanged** so the following validation rejects them.
Defaulting a malformed value to `[]` silently turns corrupt config into "no terminals"
and was a real bug. Tests cover this; keep them meaningful.

## How auto-opened tabs actually work

1. The wizard asks for comma-separated URLs per project and stores them under
   `projects.<path>.urls` in `terminals.json`.
2. The launcher's embedded JXA collects the URLs of the selected projects, dedupes them,
   and writes them into the generated workspace as the setting
   `vibecodeWorkspace.autoOpenUrls`.
3. The launcher syncs the extension into the editor's extensions folder, then opens the
   workspace via `open -a`. The sync is a regular VSIX installation so the extension is
   registered even after a previous uninstall.
4. The extension activates `onStartupFinished`, reads that setting, and opens one polling
   webview tab per URL.

The bash side never opens URLs itself. If you find an `open <url>` or
`"$EDITOR_CMD" <url>` call in the launcher, it is a regression — see pitfalls 1 and 3.

## Verifying without the interactive dialogs

The wizard needs GUI dialogs, but the workspace generation can be driven headlessly:

```bash
cd workspaces
awk '/^osascript -l JavaScript - /{f=1;next} /^JXA$/{f=0} f' "VibeCode Workspace.command" > /tmp/jxa.js
d="$(mktemp -d)"
printf 'patigon-capential\n' > "$d/sel.txt"
printf 'patigon-capential\t%s/Documents/GitHub/patigon-capential\n' "$HOME" > "$d/cfg.tsv"
: > "$d/defaults.tsv"
AUTO_START_VALUE=true CONTROL_TERMINAL_ENABLED_VALUE=false \
CONTROL_SCRIPT_VALUE="" CONTROL_CONFIG_DIR_VALUE="" \
osascript -l JavaScript /tmp/jxa.js "$d/sel.txt" "$d/cfg.tsv" "$d/defaults.tsv" \
  "$d/out.json" "$HOME/.config/vibecode-workspace/terminals.json"
python3 -c "import json;d=json.load(open('$d/out.json'));print(d['settings'].get('vibecodeWorkspace.autoOpenUrls'));print([t['label'] for t in d['tasks']['tasks']])"
```

## Current project ports

| Project | Dev server | Storybook |
|---------|-----------|-----------|
| patigon-capential | 5173 | 6006 |
| patigon-orthonovex | 5174 | 6007 |
| patigon-omniperc | 5175 | 6008 |

Read them from the project's `frontend/vite.config.ts` and `frontend/package.json`
rather than assuming — each repo uses a different port.
