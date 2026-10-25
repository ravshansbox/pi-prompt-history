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

test('orders all-folder history by recency across folders', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const here = join(agentDir, 'here');
  const elsewhere = join(agentDir, 'elsewhere');
  writeSession(agentDir, here, 'old here', '2020-01-01T00:00:00.000Z');
  writeSession(agentDir, elsewhere, 'new elsewhere', '2025-01-01T00:00:00.000Z');

  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  extension(pi);

  const tui = { requestRender: () => {} };
  const theme = { fg: (_colour: string, text: string) => text };
  let editor: Component | undefined;
  let search: Component | undefined;
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd: here,
    sessionManager: SessionManager.create(here),
    ui: {
      getEditorText: () => '',
      setEditorText: () => {},
      setEditorComponent: (factory: (...args: unknown[]) => Component) => {
        editor = factory(tui, { borderColor: (text: string) => text, selectList: {} }, {});
      },
      custom: (factory: (...args: unknown[]) => Component) => {
        search = factory(tui, theme, {}, () => {});
        return new Promise(() => {});
      },
    },
  } as unknown as ExtensionContext;

  await sessionStart?.({ type: 'session_start' }, ctx);
  editor?.handleInput?.('\x12');
  search?.handleInput?.('\t');
  await new Promise((resolve) => setTimeout(resolve, 100));

  const lines = search?.render(80).join('\n') ?? '';
  assert.ok(lines.includes('old here') && lines.includes('new elsewhere'), lines);
  assert.ok(lines.indexOf('new elsewhere') < lines.indexOf('old here'), lines);
});
