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

async function pickFirstAllFolderPrompt(sendAgain: boolean): Promise<string | null | undefined> {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  const here = join(agentDir, 'here');
  const elsewhere = join(agentDir, 'elsewhere');
  writeSession(agentDir, here, 'resumed prompt', '2020-01-01T00:00:00.000Z');
  writeSession(agentDir, elsewhere, 'newer elsewhere', '2025-01-01T00:00:00.000Z');

  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  extension(pi);

  const tui = { requestRender: () => {} };
  const theme = { fg: (_colour: string, text: string) => text };
  let editor: (Component & { addToHistory(text: string): void }) | undefined;
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
      setEditorComponent: (factory: (...args: unknown[]) => typeof editor) => {
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
  if (sendAgain) {
    await handlers.get('input')?.(
      { type: 'input', text: 'resumed prompt', source: 'interactive' },
      ctx,
    );
  }
  editor?.addToHistory('resumed prompt');
  editor?.handleInput?.('\x12');
  search?.handleInput?.('\t');
  await new Promise((resolve) => setTimeout(resolve, 100));
  search?.handleInput?.('\r');
  return picked;
}

test('does not put prompts replayed from a resumed session first in all-folder history', async () => {
  assert.equal(await pickFirstAllFolderPrompt(false), 'newer elsewhere');
});

test('puts a prompt sent again in this session first in all-folder history', async () => {
  assert.equal(await pickFirstAllFolderPrompt(true), 'resumed prompt');
});
