# pi-prompt-history

Prompt history extension for pi — shell-style prompt recall for the current folder.

When pi starts, this extension loads the user prompts from your previous
sessions **in the current working directory** and seeds them into the editor's
history. You can then recall them like a shell:

- **Up / Down** — recall the previous / next prompt (when the cursor is at the
  top / bottom of the editor, exactly like bash/zsh)
- **Ctrl+R** — reverse search: an incremental, fuzzy picker over your past
  prompts. Type to filter, Up/Down to move, Tab to switch between current-folder
  and all-folder history, Enter to load the prompt into the editor, Esc to
  cancel. If the editor already contains text, Ctrl+R uses it as the initial
  search query.

## Contents

- `src/index.ts` — extension entry point (custom editor + Ctrl+R overlay)
- `src/history.ts` — past-session parsing and prompt extraction

## Behavior

- **Scope:** Up/Down recall and the default Ctrl+R tab use sessions started in
  the current folder (via `SessionManager.list(cwd)`). Ctrl+R also has an
  **All folders** tab backed by `SessionManager.listAll()`.
- **Filtering:** empty input, slash-commands (`/...`), and inline bash
  (`!`, `!!`) are skipped, matching shell history hygiene.
- **De-duplication:** global — repeated prompts collapse to their most recent
  position.
- **Ordering:** chronological, so the first Up press recalls your newest prompt.
- **Limits:** each reverse search scope covers up to the 500 most recent unique
  prompts. Up/Down uses pi's built-in history ring, which keeps the most recent
  ~100 prompts plus anything you type during the session.
- New prompts you submit during the session are added to history immediately.

## Requirements

This package is meant to be used from an existing pi installation.
It relies on pi packages already available in the runtime environment:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

## Installation

```bash
pi install git:git@github.com:ravshansbox/pi-prompt-history.git
```

You can also pin to a ref:

```bash
pi install git:git@github.com:ravshansbox/pi-prompt-history.git@main
```

### Project-local install

```bash
pi install -l git:git@github.com:ravshansbox/pi-prompt-history.git
```

### Manual install

Clone and symlink if you prefer local development:

```bash
git clone git@github.com:ravshansbox/pi-prompt-history.git ~/Projects/pi-prompt-history
mkdir -p ~/.pi/agent/extensions/prompt-history
ln -sf ~/Projects/pi-prompt-history/src/index.ts ~/.pi/agent/extensions/prompt-history/index.ts
ln -sf ~/Projects/pi-prompt-history/src/history.ts ~/.pi/agent/extensions/prompt-history/history.ts
```

Or load it for a single run while testing:

```bash
pi -e ./src/index.ts
```

## Verify

After install and reload, in a folder that already has past pi sessions:

- press **Up** on an empty prompt to recall your most recent prompt
- press **Ctrl+R**, type a few characters, and confirm the matching prompts
  appear; press Tab to switch to all-folder history; press Enter to load one
  into the editor
- type part of a prompt in the editor, press **Ctrl+R**, and confirm that text is
  used as the initial search query

## Upgrade

```bash
pi update git:git@github.com:ravshansbox/pi-prompt-history.git
```

## Notes

This package keeps pi dependencies as peer dependencies and is intended as a
local reusable package. It only activates in interactive (TUI) mode.
