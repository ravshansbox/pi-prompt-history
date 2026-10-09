# pi-prompt-history

Shell-style prompt history extension for pi.

## Install

```bash
pi install npm:@ravshansbox/pi-prompt-history
```

Add `-l` to install it in project settings.

## Usage

When pi starts, this extension loads the user prompts from your previous sessions **in the current working directory** and seeds them into the editor's history. It only activates in interactive (TUI) mode.

- **Up / Down** — recall the previous / next prompt (when the cursor is at the top / bottom of the editor, exactly like bash/zsh)
- **Ctrl+R** — reverse search: an incremental, fuzzy picker over your past prompts. Type to filter, Up/Down to move, Tab to switch between current-folder and all-folder history, Enter to load the prompt into the editor, Esc to cancel. If the editor already contains text, Ctrl+R uses it as the initial search query.

### Behaviour

- **Scope:** Up/Down recall and the default Ctrl+R tab use sessions started in the current folder (via `SessionManager.list(cwd)`). Ctrl+R also has an **All folders** tab backed by `SessionManager.listAll()`.
- **Filtering:** empty input, slash-commands (`/...`), and inline bash (`!`, `!!`) are skipped, matching shell history hygiene.
- **De-duplication:** global — repeated prompts collapse to their most recent position.
- **Ordering:** chronological, so the first Up press recalls your newest prompt.
- **Limits:** each reverse search scope covers up to the 500 most recent unique prompts. Up/Down uses pi's built-in history ring, which keeps the most recent ~100 prompts plus anything you type during the session.
- New prompts you submit during the session are added to history immediately.

## Development

```bash
npm install
npm run check
```
