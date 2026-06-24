import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

async function importHistoryModule() {
  const source = await readFile(new URL('./history.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const compiledPath = join(dirname(fileURLToPath(import.meta.url)), `.history-test-${process.pid}.mjs`);
  await writeFile(compiledPath, compiled.outputText);
  try {
    return await import(`${pathToFileURL(compiledPath).href}?${Date.now()}-${Math.random()}`);
  } finally {
    await unlink(compiledPath).catch(() => undefined);
  }
}

async function writeSession(sessionDir, { id, cwd, timestamp, prompts }) {
  const entries = [
    {
      type: 'session',
      version: 3,
      id,
      timestamp,
      cwd,
    },
  ];

  let parentId = null;
  for (const [index, prompt] of prompts.entries()) {
    const entryId = `${id}-m${index}`;
    entries.push({
      type: 'message',
      id: entryId,
      parentId,
      timestamp,
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: new Date(timestamp).getTime() + index,
      },
    });
    parentId = entryId;
  }

  await writeFile(join(sessionDir, `${timestamp.replace(/[:.]/g, '-')}_${id}.jsonl`), `${entries.map(JSON.stringify).join('\n')}\n`);
}

test('loadPromptHistory defaults to current folder sessions', async () => {
  const { loadPromptHistory } = await importHistoryModule();
  const sessionDir = await mkdtemp(join(tmpdir(), 'pi-prompt-history-'));

  try {
    await writeSession(sessionDir, {
      id: 'current',
      cwd: '/project/current',
      timestamp: '2026-01-01T00:00:00.000Z',
      prompts: ['current prompt'],
    });
    await writeSession(sessionDir, {
      id: 'other',
      cwd: '/project/other',
      timestamp: '2026-01-02T00:00:00.000Z',
      prompts: ['other prompt'],
    });

    const prompts = await loadPromptHistory({ cwd: '/project/current', sessionDir });

    assert.deepEqual(prompts, ['current prompt']);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test('loadPromptHistory can include sessions from all folders', async () => {
  const { loadPromptHistory } = await importHistoryModule();
  const sessionDir = await mkdtemp(join(tmpdir(), 'pi-prompt-history-'));

  try {
    await writeSession(sessionDir, {
      id: 'current',
      cwd: '/project/current',
      timestamp: '2026-01-01T00:00:00.000Z',
      prompts: ['current prompt'],
    });
    await writeSession(sessionDir, {
      id: 'other',
      cwd: '/project/other',
      timestamp: '2026-01-02T00:00:00.000Z',
      prompts: ['other prompt'],
    });

    const prompts = await loadPromptHistory({ cwd: '/project/current', sessionDir, scope: 'all' });

    assert.deepEqual(prompts, ['current prompt', 'other prompt']);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});
