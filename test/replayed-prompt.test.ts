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

function writeSession(agentDir: string, cwd: string, prompt: string, timestamp: string): void {
  const dir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'session', version: 3, id: prompt, timestamp, cwd },
    {
      type: 'message',
      id: `${prompt}-1`,
      parentId: null,
      timestamp,
      message: { role: 'user', content: prompt, timestamp: Date.parse(timestamp) },
    },
  ];
  writeFileSync(join(dir, `${prompt}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

test('keeps prompts replayed from a resumed session in place in up history', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const cwd = join(agentDir, 'here');
  writeSession(agentDir, cwd, 'resumed prompt', '2020-01-01T00:00:00.000Z');
  writeSession(agentDir, cwd, 'newer prompt', '2025-01-01T00:00:00.000Z');

  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  extension(pi);

  type Editor = Component & {
    handleInput(data: string): void;
    addToHistory(text: string): void;
    getText(): string;
  };
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
  editor?.addToHistory('resumed prompt');

  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'newer prompt');
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'resumed prompt');
});
