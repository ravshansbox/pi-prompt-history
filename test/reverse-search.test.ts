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
