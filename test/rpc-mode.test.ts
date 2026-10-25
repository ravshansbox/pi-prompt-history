import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import extension from '../index.ts';

test('does not replace the editor in RPC mode', async () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-prompt-history-'));
  process.env['PI_CODING_AGENT_DIR'] = agentDir;

  let sessionStart: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on: (name: string, handler: typeof sessionStart) => {
      if (name === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  extension(pi);

  let replaced = false;
  const ctx = {
    hasUI: true,
    mode: 'rpc',
    cwd: agentDir,
    ui: {
      setEditorComponent: () => {
        replaced = true;
      },
    },
  } as unknown as ExtensionContext;

  await sessionStart?.({ type: 'session_start' }, ctx);

  assert.equal(replaced, false);
});
