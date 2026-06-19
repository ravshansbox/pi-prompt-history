import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./history.ts', import.meta.url), 'utf8');

test('prompt history reads session files asynchronously', () => {
  assert.doesNotMatch(source, /\breadFileSync\b/);
});
