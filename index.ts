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
} from "@earendil-works/pi-coding-agent";
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
} from "@earendil-works/pi-tui";
import { loadPromptHistory } from "./history.js";

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
		if (trimmed.length > 0 && !trimmed.startsWith("/") && !trimmed.startsWith("!")) {
			const existing = this.promptHistory.indexOf(trimmed);
			if (existing !== -1) this.promptHistory.splice(existing, 1);
			this.promptHistory.push(trimmed);
		}
		super.addToHistory(text);
	}

	override handleInput(data: string): void {
		if (matchesKey(data, "ctrl+r")) {
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
class ReverseSearch implements Component {
	private query = "";
	/** Prompts in newest-first order (the natural reverse-search direction). */
	private readonly ordered: string[];
	private list: SelectList;
	private readonly header: Text;

	constructor(
		prompts: string[],
		private readonly theme: Theme,
		private readonly listTheme: SelectListTheme,
		private readonly done: (value: string | null) => void,
	) {
		this.ordered = [...prompts].reverse();
		this.header = new Text("", 1, 0);
		this.list = this.buildList(this.ordered);
		this.refreshHeader();
	}

	private buildList(prompts: string[]): SelectList {
		const items: SelectItem[] = prompts.map((prompt) => ({
			value: prompt,
			label: prompt.replace(/\s+/g, " ").trim(),
		}));
		const list = new SelectList(items, 10, this.listTheme);
		list.onSelect = (item) => this.done(item.value);
		list.onCancel = () => this.done(null);
		return list;
	}

	private refreshHeader(): void {
		const label = this.theme.fg("accent", "reverse-search");
		const q =
			this.query.length > 0
				? this.theme.fg("toolOutput", this.query)
				: this.theme.fg("dim", "(type to filter)");
		const hint = this.theme.fg("dim", "  ↑↓ move · Enter load · Esc cancel");
		this.header.setText(`${label}: ${q}${hint}`);
	}

	private applyFilter(): void {
		const filtered =
			this.query.trim().length === 0
				? this.ordered
				: fuzzyFilter(this.ordered, this.query, (p) => p);
		this.list = this.buildList(filtered);
		this.refreshHeader();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done(null);
			return;
		}
		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			const item = this.list.getSelectedItem();
			this.done(item ? item.value : null);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			this.list.handleInput(data);
			return;
		}
		if (matchesKey(data, "backspace")) {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1);
				this.applyFilter();
			}
			return;
		}
		// Printable characters extend the query.
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.applyFilter();
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

export default function (pi: ExtensionAPI) {
	let editor: HistoryEditor | undefined;

	const openReverseSearch = async (ctx: ExtensionContext) => {
		// custom() only renders in TUI mode; it is a no-op elsewhere, and hasUI
		// is the version-stable guard across pi releases.
		if (!ctx.hasUI || !editor) return;
		const prompts = editor.getHistory();
		if (prompts.length === 0) {
			ctx.ui.notify("No prompt history yet", "info");
			return;
		}

		const listTheme = getSelectListTheme();
		const result = await ctx.ui.custom<string | null>(
			(_tui, theme, _kb, done) => new ReverseSearch(prompts, theme, listTheme, done),
		);

		if (result) {
			ctx.ui.setEditorText(result);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
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
