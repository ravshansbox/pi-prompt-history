/**
 * Prompt history loading and filtering.
 *
 * Reads past session JSONL files for the current working directory and
 * extracts the user prompts in chronological order, so they can seed pi's
 * built-in editor history (Up/Down recall) and back the Ctrl+R reverse search.
 */

import { readFile } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** Maximum number of prompts to retain after filtering and de-duplication. */
export const DEFAULT_HISTORY_LIMIT = 500;

export interface LoadHistoryOptions {
	/** Working directory whose sessions should be scanned. */
	cwd: string;
	/** Custom session directory (defaults to pi's standard location). */
	sessionDir?: string;
	/** Cap on the number of returned prompts (default: DEFAULT_HISTORY_LIMIT). */
	limit?: number;
}

interface RawEntry {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
}

/**
 * Extract plain text from a user message's content, which may be a string or
 * an array of content blocks (text/image). Images and non-text blocks are
 * ignored.
 */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("\n");
}

/**
 * Decide whether a prompt should be remembered. Mirrors shell history hygiene:
 * skip empty input, slash-commands, and inline bash (`!` / `!!`).
 */
function isRecallablePrompt(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.startsWith("/")) return false;
	if (trimmed.startsWith("!")) return false;
	return true;
}

/**
 * Read a single session file and return its user prompts in file order
 * (oldest first within that session). Malformed lines are skipped.
 */
async function readPromptsFromFile(filePath: string): Promise<string[]> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch {
		return [];
	}

	const prompts: string[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let entry: RawEntry;
		try {
			entry = JSON.parse(trimmed) as RawEntry;
		} catch {
			continue;
		}
		if (entry.type !== "message") continue;
		if (entry.message?.role !== "user") continue;
		const text = extractText(entry.message.content);
		if (isRecallablePrompt(text)) prompts.push(text.trim());
	}
	return prompts;
}

/**
 * Load past prompts for the current folder, oldest first.
 *
 * Ordering: sessions are processed oldest-to-newest, and prompts within each
 * session keep their natural order. The result is therefore chronological,
 * so the most recent prompt ends up last — which is what pi's editor history
 * wants (the first Up press recalls the newest prompt).
 *
 * De-duplication is global and keeps the most recent occurrence of each
 * unique prompt.
 */
export async function loadPromptHistory(options: LoadHistoryOptions): Promise<string[]> {
	const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;

	let sessions: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		sessions = await SessionManager.list(options.cwd, options.sessionDir);
	} catch {
		return [];
	}

	// SessionManager.list returns newest-modified first; reverse to oldest-first
	// so the concatenated prompt stream is chronological.
	const ordered = [...sessions].sort((a, b) => a.modified.getTime() - b.modified.getTime());

	const all: string[] = [];
	for (const session of ordered) {
		for (const prompt of await readPromptsFromFile(session.path)) {
			all.push(prompt);
		}
	}

	// Global de-dup keeping the most recent occurrence. Walk from the end,
	// collect first-seen (i.e. newest) prompts, then restore chronological order.
	const seen = new Set<string>();
	const newestFirst: string[] = [];
	for (let i = all.length - 1; i >= 0; i--) {
		const prompt = all[i];
		if (seen.has(prompt)) continue;
		seen.add(prompt);
		newestFirst.push(prompt);
		if (newestFirst.length >= limit) break;
	}

	return newestFirst.reverse();
}
