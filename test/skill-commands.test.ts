import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type ExtensionAPI,
  type ExtensionContext,
  initTheme,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import extension from '../index.ts';
import { normalizePrompt } from '../src/history.ts';

const BLOCK =
  '<skill name="demo" location="/skills/demo/SKILL.md">\nReferences are relative to /skills/demo.\n\nbody\n</skill>\n\ndo it';

test('rewrites an expanded skill block into its command when enabled', () => {
  assert.equal(normalizePrompt(BLOCK, { recallSkillCommands: true }), '/skill:demo do it');
  assert.equal(normalizePrompt(BLOCK), null);
});

test('keeps an expanded skill block without arguments', () => {
  const block = '<skill name="demo" location="/skills/demo/SKILL.md">\nbody\n</skill>';
  assert.equal(normalizePrompt(block, { recallSkillCommands: true }), '/skill:demo');
});

test('recalls skill commands typed in full only when enabled', () => {
  assert.equal(
    normalizePrompt('/skill:demo do it', { recallSkillCommands: true }),
    '/skill:demo do it',
  );
  assert.equal(normalizePrompt('/skill:demo do it'), null);
  assert.equal(normalizePrompt('/fix', { recallSkillCommands: true }), null);
  assert.equal(normalizePrompt('!ls', { recallSkillCommands: true }), null);
});

type Editor = Component & {
  addToHistory(text: string): void;
  getText(): string;
  handleInput(data: string): void;
};

async function loadEditor(settings: unknown): Promise<Editor | undefined> {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const cwd = join(agentDir, 'work');
  const dir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
  mkdirSync(dir, { recursive: true });
  const timestamp = '2025-01-01T00:00:00.000Z';
  const lines = [
    { type: 'session', version: 3, id: 'skill', timestamp, cwd },
    {
      type: 'message',
      id: 'm0',
      parentId: null,
      timestamp,
      message: { role: 'user', content: 'first', timestamp: Date.parse(timestamp) },
    },
    {
      type: 'message',
      id: 'm1',
      parentId: 'm0',
      timestamp,
      message: { role: 'user', content: BLOCK, timestamp: Date.parse(timestamp) + 1000 },
    },
  ];
  writeFileSync(join(dir, 'skill.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n'));

  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
    getSettings: () => settings,
  } as unknown as ExtensionAPI;
  extension(pi);

  let editor: Editor | undefined;
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd,
    sessionManager: SessionManager.create(cwd),
    ui: {
      setEditorComponent: (factory: (...args: unknown[]) => Editor) => {
        editor = factory(
          { requestRender: () => {}, terminal: { rows: 40 } },
          { borderColor: (text: string) => text, selectList: {} },
          { matches: () => false },
        );
      },
    },
  } as unknown as ExtensionContext;

  await sessionStart?.({ type: 'session_start' }, ctx);
  return editor;
}

test('recalls skill commands from earlier sessions when enabled', async () => {
  const editor = await loadEditor({ piPromptHistory: { recallSkillCommands: true } });
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), '/skill:demo do it');
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'first');
});

test('keeps skipping skill blocks by default', async () => {
  const editor = await loadEditor({});
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'first');
});

test('compacts a live skill block when enabled', async () => {
  const editor = await loadEditor({ piPromptHistory: { recallSkillCommands: true } });
  editor?.addToHistory(BLOCK);
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), '/skill:demo do it');
});
