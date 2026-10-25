import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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

test('recalls a prompt sent again only at its newest position with up', async () => {
  initTheme('dark');
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;

  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  extension(pi);

  const tui = { requestRender: () => {}, terminal: { rows: 40 } };
  type Editor = Component & {
    handleInput(data: string): void;
    addToHistory(text: string): void;
    getText(): string;
  };
  let editor: Editor | undefined;
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd: agentDir,
    ui: {
      setEditorComponent: (factory: (...args: unknown[]) => Editor) => {
        editor = factory(
          tui,
          { borderColor: (text: string) => text, selectList: {} },
          {
            matches: () => false,
          },
        );
      },
    },
  } as unknown as ExtensionContext;

  await sessionStart?.({ type: 'session_start' }, ctx);
  editor?.addToHistory('first');
  editor?.addToHistory('second');
  editor?.addToHistory('first');

  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'first');
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'second');
  editor?.handleInput('\x1b[A');
  assert.equal(editor?.getText(), 'second');
});
