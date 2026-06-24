import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

async function compileModulePair() {
  const dir = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.reverse-search-test-'));
  const historySource = await readFile(new URL('./history.ts', import.meta.url), 'utf8');
  const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  };

  await writeFile(join(dir, 'history.js'), ts.transpileModule(historySource, { compilerOptions }).outputText);
  await writeFile(join(dir, 'index.mjs'), ts.transpileModule(indexSource, { compilerOptions }).outputText);

  try {
    return await import(`${pathToFileURL(join(dir, 'index.mjs')).href}?${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function plainTheme() {
  return {
    fg: (_colour, text) => text,
  };
}

function plainListTheme() {
  return {
    selectedPrefix: (text) => text,
    selectedText: (text) => text,
    description: (text) => text,
    scrollInfo: (text) => text,
    noMatch: (text) => text,
  };
}

function renderText(component) {
  return component.render(120).join('\n');
}

test('reverse search starts on current-folder tab with the editor text as query', async () => {
  const { ReverseSearch } = await compileModulePair();
  let selected = null;
  const search = new ReverseSearch(
    ['write tests', 'fix parser bug'],
    'fix',
    async () => ['fix issue from another folder'],
    { requestRender() {} },
    plainTheme(),
    plainListTheme(),
    (value) => {
      selected = value;
    },
  );

  const output = renderText(search);

  assert.match(output, /\[Current folder\]/);
  assert.match(output, /All folders/);
  assert.match(output, /reverse-search: fix/);
  assert.match(output, /fix parser bug/);
  assert.doesNotMatch(output, /write tests/);

  search.handleInput('\r');

  assert.equal(selected, 'fix parser bug');
});

test('reverse search switches to all-folder tab and preserves the initial query', async () => {
  const { ReverseSearch } = await compileModulePair();
  let renderRequests = 0;
  let selected = null;
  const search = new ReverseSearch(
    ['current prompt'],
    'fix',
    async () => ['global prompt', 'fix issue from another folder'],
    { requestRender() { renderRequests++; } },
    plainTheme(),
    plainListTheme(),
    (value) => {
      selected = value;
    },
  );

  search.handleInput('\t');
  await new Promise((resolve) => setImmediate(resolve));

  const output = renderText(search);

  assert.match(output, /Current folder/);
  assert.match(output, /\[All folders\]/);
  assert.match(output, /reverse-search: fix/);
  assert.match(output, /fix issue from another folder/);
  assert.doesNotMatch(output, /global prompt/);
  assert.ok(renderRequests > 0);

  search.handleInput('\r');

  assert.equal(selected, 'fix issue from another folder');
});
