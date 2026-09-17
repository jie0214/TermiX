import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');
const iconCSSPath = path.join(sourceRoot, 'assets', 'tabler-icons.css');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:js|mjs|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  }));
  return nested.flat();
}

test('Tabler Icons 子集合涵蓋所有程式碼用到的 icon', async () => {
  const css = await readFile(iconCSSPath, 'utf8');
  const used = new Set();
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\bti ti-([a-z0-9-]+)/g)) {
      used.add(match[1]);
    }
  }

  const missing = [...used].filter(name => !css.includes(`.ti-${name}::before`)).sort();
  assert.deepEqual(missing, [], `缺少 icon mapping：${missing.join(', ')}`);
});

test('Tabler Icons 僅輸出 WOFF2 字型', async () => {
  const css = await readFile(iconCSSPath, 'utf8');
  assert.match(css, /tabler-icons\.woff2/);
  assert.doesNotMatch(css, /tabler-icons\.(?:woff|ttf)["')?]/);
});
