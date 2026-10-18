# VibeCode Workspace

macOS launcher that opens multiple repositories in one VS Code workspace with
per-project terminals and auto-opened URL tabs.

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
- **Never copy a starter.** The root `Launch Workspace.command` and
  `Setup Workspace.command` are six-line forwarders into `workspaces/`; the logic exists
  once. Desktop starters are Finder *aliases*, never copies.
- **Run `node --test tests/terminals.test.js`.** The tests drive the real JXA wizard with
  scripted dialog answers, so adding a dialog breaks them and the answers must be updated.

## Layout

- `workspaces/` — launcher, setup wizard (`terminal-setup.js`), auto-open-tabs extension
- `remote/` — Wake-on-LAN / SSH helper
- `local-dev/` — local AI provider profiles
- `tests/` — Node test runner, executes the real JXA code
- User data lives outside the repo in `~/.config/vibecode-workspace/terminals.json`
