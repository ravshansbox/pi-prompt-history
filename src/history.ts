import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';

export const DEFAULT_HISTORY_LIMIT = 500;

export type HistoryScope = 'current' | 'all';

export interface LoadHistoryOptions extends RecallOptions {
  cwd: string;
  sessionDir?: string;
  scope?: HistoryScope;
  limit?: number;
  extra?: TimedPrompt[];
}

interface RawEntry {
  type?: string;
  timestamp?: string;
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

export interface RecallOptions {
  /**
   * Recall expanded `/skill:name args` blocks as the command that produced
   * them, instead of skipping them. Off by default: an expanded block repeats
   * the whole skill body, which would crowd out everything else in a short
   * history ring.
   */
  recallSkillCommands?: boolean;
}

const SKILL_BLOCK_START = '<skill name="';
const SKILL_BLOCK_END = '</skill>';
const SKILL_NAME = /^<skill name="([^"]+)"/;

/**
 * Reduce a prompt to the form worth recalling, or null when it should stay out
 * of history. With `recallSkillCommands`, an expanded block becomes the
 * `/skill:name args` command that produced it, so the instructions are not
 * stored in history and the tail the user typed is kept.
 */
export function normalizePrompt(text: string, options: RecallOptions = {}): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('/')) {
    if (!options.recallSkillCommands || !trimmed.startsWith('/skill:')) return null;
    return trimmed;
  }
  if (trimmed.startsWith('!')) return null;
  if (!trimmed.startsWith(SKILL_BLOCK_START)) return trimmed;
  if (!options.recallSkillCommands) return null;

  const name = SKILL_NAME.exec(trimmed)?.[1];
  const end = trimmed.lastIndexOf(SKILL_BLOCK_END);
  if (name === undefined || end === -1) return null;

  const args = trimmed.slice(end + SKILL_BLOCK_END.length).trim();
  return `/skill:${name}${args.length > 0 ? ` ${args}` : ''}`;
}

export function isRecallablePrompt(text: string, options: RecallOptions = {}): boolean {
  return normalizePrompt(text, options) !== null;
}

export function isSkillBlock(text: string): boolean {
  return text.trim().startsWith(SKILL_BLOCK_START);
}

export interface TimedPrompt {
  text: string;
  time: number;
}

async function readPromptsFromFile(
  filePath: string,
  fallbackTime: number,
  options: RecallOptions,
): Promise<TimedPrompt[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const prompts: TimedPrompt[] = [];
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
    const prompt = normalizePrompt(extractText(entry.message.content), options);
    const time = Date.parse(entry.timestamp ?? '');
    if (prompt !== null) {
      prompts.push({ text: prompt, time: Number.isNaN(time) ? fallbackTime : time });
    }
  }
  return prompts;
}

function listAllSessions(sessionDir: string | undefined) {
  if (sessionDir === undefined) return SessionManager.listAll();
  const usesDefault = resolve(dirname(sessionDir)) === resolve(join(getAgentDir(), 'sessions'));
  return usesDefault ? SessionManager.listAll() : SessionManager.listAll(sessionDir);
}

export async function loadPromptHistory(options: LoadHistoryOptions): Promise<string[]> {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;

  let sessions: Awaited<ReturnType<typeof SessionManager.list>>;
  try {
    sessions =
      options.scope === 'all'
        ? await listAllSessions(options.sessionDir)
        : await SessionManager.list(options.cwd, options.sessionDir);
  } catch {
    return [];
  }

  const ordered = [...sessions].sort((a, b) => a.modified.getTime() - b.modified.getTime());

  const timed: TimedPrompt[] = [...(options.extra ?? [])];
  for (const session of ordered) {
    timed.push(...(await readPromptsFromFile(session.path, session.modified.getTime(), options)));
  }
  const all = timed.sort((a, b) => a.time - b.time).map((prompt) => prompt.text);

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
