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

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

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

test('puts a prompt sent later in a parallel session above one sent earlier here', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const here = join(agentDir, 'here');
  const elsewhere = join(agentDir, 'elsewhere');

  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  extension(pi);

  const tui = { requestRender: () => {} };
  const theme = { fg: (_colour: string, text: string) => text };
  let editor: Component | undefined;
  let search: Component | undefined;
  let picked: string | null | undefined;
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
      custom: (factory: (...args: unknown[]) => Component) =>
        new Promise((resolve) => {
          search = factory(tui, theme, {}, (value: string | null) => {
            picked = value;
            resolve(value);
          });
        }),
    },
  } as unknown as ExtensionContext;

  await handlers.get('session_start')?.({ type: 'session_start' }, ctx);
  const sentHere = new Date().toISOString();
  await handlers.get('input')?.({ type: 'input', text: 'sent here', source: 'interactive' }, ctx);
  writeSession(agentDir, here, 'sent here', sentHere);
  writeSession(
    agentDir,
    elsewhere,
    'sent later elsewhere',
    new Date(Date.now() + 60_000).toISOString(),
  );

  editor?.handleInput?.('\x12');
  search?.handleInput?.('\t');
  await new Promise((resolve) => setTimeout(resolve, 100));
  search?.handleInput?.('\r');
  assert.equal(picked, 'sent later elsewhere');
});
