import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
export const patchManifest = JSON.parse(readFileSync(new URL('../security/dependency-patches.json', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');

// 鎖定來源與修補前後雜湊；版本或檔案不同就停止，不猜測套用位置。
export function dependencyPatches({ apply = false, root = mobileRoot } = {}) {
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const verified = new Map();
  const writes = [];
  for (const patch of patchManifest.packages) {
    const locations = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${patch.name}` || path.endsWith(`/node_modules/${patch.name}`));
    if (!locations.length) throw new Error(`${patch.name} 不在 lockfile，請重新審查修補設定`);
    for (const [location, entry] of locations) {
      if (!location.startsWith('node_modules/') || location.split('/').includes('..') || entry.version !== patch.version || entry.integrity !== patch.integrity || entry.link) {
        throw new Error(`${location} 來源或版本與安全修補不符`);
      }
      const directory = resolve(root, location);
      const installed = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
      if (installed.name !== patch.name || installed.version !== patch.version) throw new Error(`${location} 安裝版本不符`);
      for (const file of patch.files) {
        const path = resolve(directory, file.path);
        const original = readFileSync(path, 'utf8');
        if (hash(original) === file.patchedSha256) continue;
        if (!apply || hash(original) !== file.originalSha256) throw new Error(`${location}/${file.path} 修補缺失或內容被修改`);
        let patched = original;
        for (const { before, after } of file.edits) {
          if (patched.split(before).length !== 2) throw new Error(`${path} 修補位置不唯一`);
          patched = patched.replace(before, after);
        }
        if (hash(patched) !== file.patchedSha256) throw new Error(`${path} 修補結果雜湊不符`);
        writes.push([path, patched]);
      }
      verified.set(location, { name: patch.name, version: patch.version, advisory: patch.advisory });
    }
  }
  // 所有檔案驗證完才寫入，避免遇到已知不符時留下部分修補。
  for (const [path, contents] of writes) writeFileSync(path, contents);
  return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const verified = dependencyPatches({ apply: process.argv.includes('--apply') });
  console.log(`PASS：${verified.size} 份依賴安全修補完整性驗證通過。`);
}
