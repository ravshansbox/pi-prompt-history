import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type ExtensionAPI,
  type ExtensionContext,
  initTheme,
} from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import extension from '../index.ts';

test('skips expanded skill commands from earlier sessions in up history', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const cwd = join(agentDir, 'work');
  const dir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
  mkdirSync(dir, { recursive: true });
  const timestamp = '2025-01-01T00:00:00.000Z';
  const prompts = [
    'first',
    '<skill name="demo" location="/skills/demo/SKILL.md">\nReferences are relative to /skills/demo.\n\nbody\n</skill>\n\ndo it',
  ];
  const lines = [
    { type: 'session', version: 3, id: 'skill', timestamp, cwd },
    ...prompts.map((content, i) => ({
      type: 'message',
      id: `m${i}`,
      parentId: i === 0 ? null : `m${i - 1}`,
      timestamp,
      message: { role: 'user', content, timestamp: Date.parse(timestamp) },
    })),
  ];
  writeFileSync(join(dir, 'skill.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n'));

  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  extension(pi);

  type Editor = Component & { handleInput(data: string): void; getText(): string };
  let editor: Editor | undefined;
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd,
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
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'first');

  editor?.handleInput('\x1b[B');
  (editor as Editor & { addToHistory(text: string): void }).addToHistory(
    '<skill name="demo" location="/skills/demo/SKILL.md">\nbody\n</skill>\n\ndo it',
  );
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'first');
});
