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

function writeSession(
  agentDir: string,
  cwd: string,
  id: string,
  prompts: [string, string][],
): void {
  const dir = join(agentDir, 'sessions', `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'session', version: 3, id, timestamp: prompts[0]![1], cwd },
    ...prompts.map(([prompt, timestamp], i) => ({
      type: 'message',
      id: `${id}-${i}`,
      parentId: i === 0 ? null : `${id}-${i - 1}`,
      timestamp,
      message: { role: 'user', content: prompt, timestamp: Date.parse(timestamp) },
    })),
  ];
  writeFileSync(join(dir, `${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

test('orders prompts from sessions run side by side by when they were sent', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const here = join(agentDir, 'here');
  writeSession(agentDir, here, 'a', [
    ['first in a', '2024-01-01T00:00:00.000Z'],
    ['third in a', '2024-01-03T00:00:00.000Z'],
  ]);
  writeSession(agentDir, here, 'b', [['second in b', '2024-01-02T00:00:00.000Z']]);

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

  const lines = search?.render(80).join('\n') ?? '';
  const order = ['third in a', 'second in b', 'first in a'].map((prompt) => lines.indexOf(prompt));
  assert.deepEqual(
    order,
    [...order].sort((x, y) => x - y),
    lines,
  );
  assert.ok(!order.includes(-1), lines);
});
