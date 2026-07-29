/**
 * Prompt History - shell-style prompt recall for pi
 *
 * Seeds pi's built-in editor history with the user prompts from previous
 * sessions in the current folder, so Up/Down recall works across restarts
 * (just like a shell). Adds Ctrl+R reverse search: an incremental, fuzzy
 * picker over the same history that drops the chosen prompt into the editor.
 *
 * - Up / Down  : recall previous / next prompt (pi's native edge-aware history)
 * - Ctrl+R     : open reverse search; type to filter, Up/Down to move,
 *                Enter to load into the editor, Esc to cancel
 */

import {
  CustomEditor,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  type EditorTheme,
  fuzzyFilter,
  matchesKey,
  SelectList,
  type SelectItem,
  type SelectListTheme,
  Text,
  type TUI,
} from '@earendil-works/pi-tui';
import { type HistoryScope, loadPromptHistory } from './history.js';

/**
 * Editor that mirrors pi's default editor but:
 *   1. seeds prompt history from disk (via setHistory),
 *   2. keeps a full-size history array for Ctrl+R reverse search, and
 *   3. opens reverse search on Ctrl+R.
 *
 * Up/Down recall is provided by the base Editor, which walks its built-in
 * history ring when the cursor is at the top/bottom visual line. pi's own
 * submit path already calls addToHistory() for each new prompt, so we simply
 * override addToHistory() as the single chokepoint that feeds both the base
 * ring and our reverse-search array. (We intentionally do not wrap onSubmit:
 * pi overwrites a custom editor's onSubmit with its own handler when the
 * editor is installed.)
 */
class HistoryEditor extends CustomEditor {
  /** Newest-last list of unique prompts backing reverse search. */
  private promptHistory: string[] = [];
  /** Opens the reverse-search overlay; supplied by the extension factory. */
  onReverseSearch?: () => void;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
  }

  /** Seed history from disk (oldest first) into both the ring and our array. */
  setHistory(prompts: string[]): void {
    this.promptHistory = [];
    for (const prompt of prompts) this.addToHistory(prompt);
  }

  /** Current prompt history, newest last. */
  getHistory(): string[] {
    return this.promptHistory;
  }

  /**
   * Single chokepoint for history. pi calls this on every submitted prompt
   * and we also call it while seeding. We record into our reverse-search
   * array (global de-dup, newest position wins) and delegate to the base
   * editor's Up/Down history ring.
   */
  override addToHistory(text: string): void {
    const trimmed = text.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith('/') &&
      !trimmed.startsWith('!')
    ) {
      const existing = this.promptHistory.indexOf(trimmed);
      if (existing !== -1) this.promptHistory.splice(existing, 1);
      this.promptHistory.push(trimmed);
    }
    super.addToHistory(text);
  }

  override handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+r')) {
      this.onReverseSearch?.();
      return;
    }
    super.handleInput(data);
  }
}

/**
 * Reverse-search overlay: a query line above a fuzzy-filtered list of prompts.
 * Returns the chosen prompt, or null if cancelled.
 *
 * SelectList only supports prefix filtering and cannot swap its item set, so
 * we drive fuzzy filtering ourselves and rebuild the list when the query
 * changes.
 */
export class ReverseSearch implements Component {
  private query: string;
  private scope: HistoryScope = 'current';
  private readonly prompts: Record<HistoryScope, string[] | undefined>;
  private loadingAll = false;
  private list: SelectList;
  private readonly header: Text;

  constructor(
    currentPrompts: string[],
    initialQuery: string,
    private readonly loadAllPrompts: () => Promise<string[]>,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly listTheme: SelectListTheme,
    private readonly done: (value: string | null) => void,
  ) {
    this.query = initialQuery.trim();
    this.prompts = { current: currentPrompts, all: undefined };
    this.header = new Text('', 1, 0);
    this.list = this.buildList(this.filteredPrompts());
    this.refreshHeader();
  }

  private buildList(prompts: string[]): SelectList {
    const items: SelectItem[] = prompts.map((prompt) => ({
      value: prompt,
      label: prompt.replace(/\s+/g, ' ').trim(),
    }));
    const list = new SelectList(items, 10, this.listTheme);
    list.onSelect = (item) => this.done(item.value);
    list.onCancel = () => this.done(null);
    return list;
  }

  private renderTabs(): string {
    return (['current', 'all'] as const)
      .map((scope) => {
        const label = scope === 'current' ? 'Current folder' : 'All folders';
        const text = this.scope === scope ? `[${label}]` : label;
        return this.scope === scope
          ? this.theme.fg('accent', text)
          : this.theme.fg('dim', text);
      })
      .join(this.theme.fg('dim', '  '));
  }

  private refreshHeader(): void {
    const label = this.theme.fg('accent', 'reverse-search');
    const q =
      this.query.length > 0
        ? this.theme.fg('toolOutput', this.query)
        : this.theme.fg('dim', '(type to filter)');
    const loading =
      this.scope === 'all' && this.loadingAll
        ? this.theme.fg('dim', ' loading…')
        : '';
    const hint = this.theme.fg(
      'dim',
      '  Tab scope · ↑↓ move · Enter load · Esc cancel',
    );
    this.header.setText(
      `${this.renderTabs()}\n${label}: ${q}${loading}${hint}`,
    );
  }

  private filteredPrompts(): string[] {
    const ordered = [...(this.prompts[this.scope] ?? [])].reverse();
    return this.query.trim().length === 0
      ? ordered
      : fuzzyFilter(ordered, this.query, (p) => p);
  }

  private applyFilter(): void {
    this.list = this.buildList(this.filteredPrompts());
    this.refreshHeader();
  }

  private switchScope(nextScope: HistoryScope): void {
    this.scope = nextScope;
    if (nextScope === 'all' && !this.prompts.all && !this.loadingAll) {
      this.loadingAll = true;
      void this.loadAllPrompts()
        .then((prompts) => {
          this.prompts.all = prompts;
        })
        .catch(() => {
          this.prompts.all = [];
        })
        .finally(() => {
          this.loadingAll = false;
          this.applyFilter();
          this.tui.requestRender();
        });
    }
    this.applyFilter();
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.done(null);
      return;
    }
    if (matchesKey(data, 'return') || matchesKey(data, 'enter')) {
      const item = this.list.getSelectedItem();
      this.done(item ? item.value : null);
      return;
    }
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
      this.switchScope(this.scope === 'current' ? 'all' : 'current');
      return;
    }
    if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) {
      this.switchScope(this.scope === 'current' ? 'all' : 'current');
      return;
    }
    if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
      this.list.handleInput(data);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, 'backspace')) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
        this.tui.requestRender();
      }
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.query += data;
      this.applyFilter();
      this.tui.requestRender();
      return;
    }
  }

  render(width: number): string[] {
    return [...this.header.render(width), ...this.list.render(width)];
  }

  invalidate(): void {
    this.header.invalidate();
    this.list.invalidate();
  }
}

function uniqueNewest(prompts: string[]): string[] {
  const seen = new Set<string>();
  const newestFirst: string[] = [];
  for (const prompt of [...prompts].reverse()) {
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    newestFirst.push(prompt);
  }
  return newestFirst.reverse();
}

export default function (pi: ExtensionAPI) {
  let editor: HistoryEditor | undefined;

  const openReverseSearch = async (ctx: ExtensionContext) => {
    // custom() only renders in TUI mode; it is a no-op elsewhere, and hasUI
    // is the version-stable guard across pi releases.
    if (!ctx.hasUI || !editor) return;
    const currentPrompts = editor.getHistory();
    const initialQuery = ctx.ui.getEditorText().trim();

    const listTheme = getSelectListTheme();
    const result = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) =>
        new ReverseSearch(
          currentPrompts,
          initialQuery,
          async () => {
            const diskPrompts = await loadPromptHistory({
              cwd: ctx.cwd,
              scope: 'all',
            });
            return uniqueNewest([
              ...diskPrompts,
              ...(editor?.getHistory() ?? []),
            ]);
          },
          tui,
          theme,
          listTheme,
          done,
        ),
    );

    if (result) {
      ctx.ui.setEditorText(result);
    }
  };

  pi.on('session_start', async (_event, ctx) => {
    // Editor replacement only matters when there is an interactive UI.
    if (!ctx.hasUI) return;

    const prompts = await loadPromptHistory({ cwd: ctx.cwd });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const next = new HistoryEditor(tui, theme, keybindings);
      next.setHistory(prompts);
      next.onReverseSearch = () => {
        void openReverseSearch(ctx);
      };
      editor = next;
      return next;
    });
  });
}
