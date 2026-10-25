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

test('shows the working status in the editor border', async () => {
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
  let editor: (Component & { setWorkingStatusIndicator(indicator: unknown): void }) | undefined;
  const ctx = {
    hasUI: true,
    cwd: agentDir,
    ui: {
      setEditorComponent: (factory: (...args: unknown[]) => typeof editor) => {
        editor = factory(tui, { borderColor: (text: string) => text, selectList: {} }, {});
      },
    },
  } as unknown as ExtensionContext;

  await sessionStart?.({ type: 'session_start' }, ctx);
  editor?.setWorkingStatusIndicator({
    renderInBorder: () => ' Working ',
    renderSpinnerInBorder: () => ' * ',
  });

  const lines = editor?.render(80) ?? [];
  assert.ok(lines[0]?.includes('Working'), lines.join('\n'));
});
