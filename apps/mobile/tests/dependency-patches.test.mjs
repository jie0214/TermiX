import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { dependencyPatches, mobileRoot, patchManifest } from '../scripts/dependency-patches.mjs';
import { validateAudit } from '../scripts/check-npm-security.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'termix-patches-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = {};
  for (const patch of patchManifest.packages) {
    const location = `node_modules/${patch.name}`;
    packages[location] = { version: patch.version, integrity: patch.integrity };
    mkdirSync(resolve(root, location), { recursive: true });
    writeFileSync(resolve(root, location, 'package.json'), JSON.stringify({ name: patch.name, version: patch.version }));
    for (const file of patch.files) {
      const path = resolve(root, location, file.path);
      mkdirSync(resolve(path, '..'), { recursive: true });
      let source = readFileSync(resolve(mobileRoot, location, file.path), 'utf8');
      // 同時支援在尚未修補及已修補的安裝上執行測試。
      for (const { before, after } of [...file.edits].reverse()) source = source.replace(after, before);
      writeFileSync(path, source);
    }
  }
  writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ packages }));
  return root;
}

test('乾淨依賴缺少修補時阻擋；套用後可重複驗證與套用', t => {
  const root = fixture(t);
  assert.throws(() => dependencyPatches({ root }), /修補缺失/);
  assert.equal(dependencyPatches({ root, apply: true }).size, 2);
  assert.equal(dependencyPatches({ root }).size, 2);
  assert.equal(dependencyPatches({ root, apply: true }).size, 2);
});

test('修補檔案遭修改時不覆寫，且驗證失敗', t => {
  const root = fixture(t);
  dependencyPatches({ root, apply: true });
  const path = resolve(root, 'node_modules/node-forge/lib/rsa.js');
  const changed = readFileSync(path, 'utf8') + '\n// 被修改\n';
  writeFileSync(path, changed);
  assert.throws(() => dependencyPatches({ root }), /被修改/);
  assert.throws(() => dependencyPatches({ root, apply: true }), /被修改/);
  assert.equal(readFileSync(path, 'utf8'), changed);
});

test('版本或 lockfile 完整性變更時必須重新審查', t => {
  for (const field of ['version', 'integrity']) {
    const root = fixture(t);
    const path = resolve(root, 'package-lock.json');
    const lock = JSON.parse(readFileSync(path, 'utf8'));
    lock.packages['node_modules/braces'][field] = 'changed';
    writeFileSync(path, JSON.stringify(lock));
    assert.throws(() => dependencyPatches({ root, apply: true }), /來源或版本/);
  }
});

const verified = new Map(patchManifest.packages.map(patch => [`node_modules/${patch.name}`, patch]));
function auditFixture() {
  const vulnerabilities = {};
  for (const patch of patchManifest.packages) {
    vulnerabilities[patch.name] = { name: patch.name, severity: 'high', nodes: [`node_modules/${patch.name}`], via: [{ name: patch.name, dependency: patch.name, severity: 'high', url: `https://github.com/advisories/${patch.advisory}` }] };
  }
  vulnerabilities.expo = { name: 'expo', severity: 'high', nodes: ['node_modules/expo'], via: ['braces', 'node-forge'] };
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 3, critical: 0, total: 3 } } };
}

test('僅接受兩個已修補公告與其依賴傳播', () => {
  assert.equal(validateAudit(auditFixture(), verified), 3);
  const cycleWithAdvisory = auditFixture();
  cycleWithAdvisory.vulnerabilities.expo.via.push('expo');
  assert.equal(validateAudit(cycleWithAdvisory, verified), 3);
  assert.throws(() => validateAudit(auditFixture(), new Map()), /尚未修補/);
});

test('新增公告或未驗證的巢狀安裝仍阻擋', () => {
  const unknown = auditFixture();
  unknown.vulnerabilities.braces.via.push({ name: 'braces', dependency: 'braces', severity: 'high', url: 'https://github.com/advisories/GHSA-new' });
  assert.throws(() => validateAudit(unknown, verified), /尚未修補/);
  const nested = auditFixture();
  nested.vulnerabilities.braces.nodes.push('node_modules/expo/node_modules/braces');
  assert.throws(() => validateAudit(nested, verified), /尚未修補/);
});

test('audit 服務錯誤、資料缺失及循環不得當成成功', () => {
  for (const report of [{}, { error: { code: 'ENETUNREACH' } }, { ...auditFixture(), vulnerabilities: {} }]) {
    assert.throws(() => validateAudit(report, verified));
  }
  const missing = auditFixture();
  missing.vulnerabilities.expo.via = ['missing'];
  assert.throws(() => validateAudit(missing, verified), /尚未修補/);
  const cycle = auditFixture();
  cycle.vulnerabilities.expo.via = ['expo'];
  assert.throws(() => validateAudit(cycle, verified), /尚未修補/);
});
