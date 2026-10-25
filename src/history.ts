import { readFile } from 'node:fs/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';

export const DEFAULT_HISTORY_LIMIT = 500;

export type HistoryScope = 'current' | 'all';

export interface LoadHistoryOptions {
  cwd: string;
  sessionDir?: string;
  scope?: HistoryScope;
  limit?: number;
}

interface RawEntry {
  type?: string;
  message?: { role?: string; content?: unknown };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('\n');
}

export function isRecallablePrompt(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('!')) return false;
  return true;
}

async function readPromptsFromFile(filePath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const prompts: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: RawEntry;
    try {
      entry = JSON.parse(trimmed) as RawEntry;
    } catch {
      continue;
    }
    if (entry.type !== 'message') continue;
    if (entry.message?.role !== 'user') continue;
    const text = extractText(entry.message.content);
    if (isRecallablePrompt(text)) prompts.push(text.trim());
  }
  return prompts;
}

export async function loadPromptHistory(options: LoadHistoryOptions): Promise<string[]> {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;

  let sessions: Awaited<ReturnType<typeof SessionManager.list>>;
  try {
    sessions =
      options.scope === 'all'
        ? await SessionManager.listAll(options.sessionDir)
        : await SessionManager.list(options.cwd, options.sessionDir);
  } catch {
    return [];
  }

  const ordered = [...sessions].sort((a, b) => a.modified.getTime() - b.modified.getTime());

  const all: string[] = [];
  for (const session of ordered) {
    for (const prompt of await readPromptsFromFile(session.path)) {
      all.push(prompt);
    }
  }

  const seen = new Set<string>();
  const newestFirst: string[] = [];
  for (const prompt of [...all].reverse()) {
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    newestFirst.push(prompt);
    if (newestFirst.length >= limit) break;
  }

  return newestFirst.reverse();
}
