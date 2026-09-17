import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylePath = new URL('../style.css', import.meta.url);

test('CSS 使用的自訂屬性必須有定義或 fallback', async () => {
  const css = (await Promise.all([
    readFile(stylePath, 'utf8'),
    readFile(new URL('../components/controls/button-system.css', import.meta.url), 'utf8'),
  ])).join('\n');
  const definitions = new Set(
    [...css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(match => match[1]),
  );
  const missing = new Set();

  for (const match of css.matchAll(/var\((--[a-zA-Z0-9_-]+)([^)]*)\)/g)) {
    const [, name, remainder] = match;
    if (!definitions.has(name) && !remainder.includes(',')) {
      missing.add(name);
    }
  }

  assert.deepEqual([...missing].sort(), []);
});
