# VibeCode Workspace

macOS launcher that opens multiple repositories in one VS Code workspace with
per-project terminals and auto-opened URL tabs.

## Public repository: privacy and secrets (always applies)

- Never commit real personal names, usernames, email addresses, device/host names, network
  addresses, home-directory paths, account identifiers or identifiable customer/project names.
  This includes source code, tests, fixtures, examples, documentation, skills and commit messages.
- Use synthetic examples only: `user`, `remote-mac.local`, `/Users/example/`, `example-api`
  and documentation addresses such as `192.0.2.5`. Loopback addresses used by local services are fine.
  Reproduce the structure of a bug with invented data, never the user's actual connection details.
- Never commit credentials, real SSH keys (public or private), real key fingerprints or tokens.
  Tests may generate disposable keys inside temporary directories and use clearly dummy values.
- Never copy personal data from the clipboard, system output, screenshots, logs or local configuration
  into tracked files. Keep runtime data outside the repo or in explicitly ignored local files.
  Never force-add those files. `.gitignore` does not protect inline content or already tracked files.
- Before every commit, review the complete staged diff and new files for personal data and secrets;
  run a secret scan with redacted output. Secret scanners do not replace the manual privacy review.
  Before pushing, review every outgoing commit, including messages and author/committer identities.
- Use the repository-local neutral Git identity `VibeCode Contributors <contributors@example.invalid>`
  for commits. Configure it in each fresh clone; never change the global Git identity for this project.
- Do not merge or push pre-cleanup history from an old clone. Use a fresh clone and port only reviewed
  changes. If sensitive data is already committed, inspect history as well as the current files.
- Keep the privacy sections in `AGENTS.md` and `CLAUDE.md` synchronized; the always-on Cursor rule points here.

## Before changing the launcher

Read `.agents/skills/vibecode-workspace-launcher/SKILL.md`. It documents pitfalls that
already cost a full debugging session each — including several changes that look correct
but silently do the wrong thing.

The short version:

- **Never open URLs from the shell.** `code <url>` opens an *empty file*, not a browser
  tab, and the VS Code CLI has no `--command` flag. URLs travel as the workspace setting
  `vibecodeWorkspace.autoOpenUrls` and are opened by the bundled extension in
  `workspaces/vscode-extension/auto-open-tabs/`.
- **Never add `allow-popups`/`allow-modals`** to that extension's iframe sandbox — VS Code
  then leaks `window.open()` to the system browser.
- **Launch the editor via `open -a "<bundle>.app"`**, never by calling the `code` binary
  directly; the direct call re-registers the app with LaunchServices and adds a new Dock
  icon on every start.
- **Never copy a starter.** The only root starter is `VibeCode Workspace.command`, a short forwarder
  into `core/`; the logic exists once. The launcher and setup wizard are reached through
  the app window (or `./VibeCode\ Workspace.command launch | setup`). Desktop starters are Finder
  *aliases*, never copies; the app creates them itself for saved workspaces.
- **Run `node --test tests/terminals.test.js`.** The tests drive the real JXA wizard with
  scripted dialog answers, so adding a dialog breaks them and the answers must be updated.

## Base app (core/)

Before changing `core/`, a `module.json`, `VibeCode Workspace.command` or the launcher's `--project` /
`--list-projects` flags, read `.agents/skills/vibecode-core/SKILL.md`. It covers how the
Desktop shortcuts (Finder aliases) work, the invariants behind them, and the JXA pitfalls
that already cost failed runs (`$()` instead of `null`, button constants are strings).
Run `node --test tests/*.test.js` and `python3 -m unittest tests.test_remote tests.test_core`.

## Reaching the other Mac (SSH)

When the user wants to grant or get SSH access between their Macs ("gib Zugriff frei",
"ich will Zugriff"), connect to their other Mac (the remote Mac), or run something on it,
read `.agents/skills/vibecode-remote-ssh/SKILL.md` first. The commands are
`workspaces/workspace remote ssh share | join | allow | run`. Never use plain `ssh`: you
have no terminal, and the helper checks the target and fails fast instead of hanging on a
prompt. Never authorize a key (`allow`) the user did not explicitly ask you to authorize.

## Layout

- `VibeCode Workspace.command` + `core/` — base app (the root file is the app; the same-named file in
  `workspaces/` is the launcher underneath): main window, saved workspaces, Desktop shortcuts
- `workspaces/` — launcher, setup wizard (`terminal-setup.js`), auto-open-tabs extension
- `remote/` — keep-awake controller and SSH helper (client Mac → remote Mac)
- `local-dev/` — local AI provider profiles
- `tests/` — Node test runner (executes the real JXA code) and Python unittest
- Each module folder has a `module.json`; the base app finds modules through it
- User data lives outside the repo in `~/.config/vibecode-workspace/terminals.json`
