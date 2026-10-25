import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Theme } from '@earendil-works/pi-coding-agent';
import type { SelectListTheme, TUI } from '@earendil-works/pi-tui';
import { ReverseSearch } from '../index.ts';

const identity = (text: string) => text;
const tui = { requestRender: () => {} } as unknown as TUI;
const theme = { fg: (_colour: string, text: string) => text } as unknown as Theme;
const listTheme: SelectListTheme = {
  selectedPrefix: identity,
  selectedText: identity,
  description: identity,
  scrollInfo: identity,
  noMatch: identity,
};

test('keeps the current-folder selection when all-folder history finishes loading', async () => {
  let resolveAll: (prompts: string[]) => void = () => {};
  const allPrompts = new Promise<string[]>((resolve) => {
    resolveAll = resolve;
  });
  let result: string | null | undefined;
  const search = new ReverseSearch(
    ['older', 'newer'],
    '',
    () => allPrompts,
    tui,
    theme,
    listTheme,
    (value) => {
      result = value;
    },
  );

  search.handleInput('\t');
  search.handleInput('\t');
  search.handleInput('\x1b[B');
  resolveAll(['elsewhere']);
  await allPrompts;
  await new Promise((resolve) => setImmediate(resolve));
  search.handleInput('\r');

  assert.equal(result, 'older');
});

test('filters by pasted text', () => {
  let result: string | null | undefined;
  const search = new ReverseSearch(
    ['deploy app', 'run tests'],
    '',
    async () => [],
    tui,
    theme,
    listTheme,
    (value) => {
      result = value;
    },
  );

  search.handleInput('\x1b[200~deploy\x1b[201~');
  search.handleInput('\r');

  assert.equal(result, 'deploy app');
});

test('filters by typed characters outside the basic plane', () => {
  let result: string | null | undefined;
  const search = new ReverseSearch(
    ['ship it 🚀', 'run tests'],
    '',
    async () => [],
    tui,
    theme,
    listTheme,
    (value) => {
      result = value;
    },
  );

  search.handleInput('🚀');
  search.handleInput('\r');

  assert.equal(result, 'ship it 🚀');
});

test('removes a whole character outside the basic plane on backspace', () => {
  let result: string | null | undefined;
  const search = new ReverseSearch(
    ['ship it 🚀', 'run tests'],
    '',
    async () => [],
    tui,
    theme,
    listTheme,
    (value) => {
      result = value;
    },
  );

  search.handleInput('r');
  search.handleInput('🚀');
  search.handleInput('\x7f');
  search.handleInput('\r');

  assert.equal(result, 'run tests');
});

test('filters by characters typed as Kitty key codes', () => {
  let result: string | null | undefined;
  const search = new ReverseSearch(
    ['deploy app', 'run tests'],
    '',
    async () => [],
    tui,
    theme,
    listTheme,
    (value) => {
      result = value;
    },
  );

  search.handleInput('\x1b[100u');
  search.handleInput('\r');

  assert.equal(result, 'deploy app');
});
