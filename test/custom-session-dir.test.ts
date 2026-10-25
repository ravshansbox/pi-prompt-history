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

function defaultSessionDir(agentDir: string, cwd: string): string {
  return join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
}

function writeSession(dir: string, cwd: string, prompt: string): void {
  mkdirSync(dir, { recursive: true });
  const timestamp = '2025-01-01T00:00:00.000Z';
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

async function start(cwd: string, sessionDir: string) {
  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  extension(pi);

  const tui = { requestRender: () => {}, terminal: { rows: 40 } };
  const theme = { fg: (_colour: string, text: string) => text };
  const state: { editor?: Component & { getText(): string }; search?: Component } = {};
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd,
    sessionManager: { getSessionDir: () => sessionDir },
    ui: {
      getEditorText: () => '',
      setEditorText: () => {},
      setEditorComponent: (factory: (...args: unknown[]) => Component & { getText(): string }) => {
        state.editor = factory(
          tui,
          { borderColor: (text: string) => text, selectList: {} },
          { matches: () => false },
        );
      },
      custom: (factory: (...args: unknown[]) => Component) => {
        state.search = factory(tui, theme, {}, () => {});
        return new Promise(() => {});
      },
    },
  } as unknown as ExtensionContext;

  await sessionStart?.({ type: 'session_start' }, ctx);
  return state;
}

test('recalls prompts from a custom session folder with up', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const cwd = join(agentDir, 'here');
  const sessionDir = join(agentDir, 'custom');
  writeSession(sessionDir, cwd, 'custom prompt');
  writeSession(defaultSessionDir(agentDir, cwd), cwd, 'default prompt');

  const { editor } = await start(cwd, sessionDir);
  editor?.handleInput?.('\x1b[A');
  assert.equal(editor?.getText(), 'custom prompt');
  editor?.handleInput?.('\x1b[A');
  assert.equal(editor?.getText(), 'custom prompt');
});

test('searches all folders in a custom session folder', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const sessionDir = join(agentDir, 'custom');
  writeSession(sessionDir, join(agentDir, 'b'), 'custom elsewhere');
  writeSession(
    defaultSessionDir(agentDir, join(agentDir, 'c')),
    join(agentDir, 'c'),
    'default elsewhere',
  );

  const state = await start(join(agentDir, 'a'), sessionDir);
  state.editor?.handleInput?.('\x12');
  state.search?.handleInput?.('\t');
  await new Promise((resolve) => setTimeout(resolve, 100));

  const lines = state.search?.render(80).join('\n') ?? '';
  assert.ok(lines.includes('custom elsewhere'), lines);
  assert.ok(!lines.includes('default elsewhere'), lines);
});
