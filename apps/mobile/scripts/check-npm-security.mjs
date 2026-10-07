import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dependencyPatches, mobileRoot } from './dependency-patches.mjs';

const ranks = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

// 僅接受已驗證修補的公告及其依賴傳播；循環必須能追溯到實際公告。
export function validateAudit(report, verified) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error('npm audit 回應無效，不能確認安全狀態');
  }
  const entries = Object.entries(report.vulnerabilities);
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: entries.length };
  for (const [name, entry] of entries) {
    if (entry.name !== name || !(entry.severity in ranks) || !Array.isArray(entry.via) || !entry.via.length || !Array.isArray(entry.nodes) || !entry.nodes.length) {
      throw new Error(`npm audit 節點 ${name} 不完整`);
    }
    counts[entry.severity]++;
  }
  for (const [severity, count] of Object.entries(counts)) {
    if (report.metadata.vulnerabilities[severity] !== count) throw new Error('npm audit 統計與節點不一致');
  }
  const covered = name => {
    const pending = [name];
    const visited = new Set();
    let advisories = 0;
    while (pending.length) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      const entry = report.vulnerabilities[current];
      if (!entry) return false;
      for (const advisory of entry.via) {
        if (typeof advisory === 'string') {
          pending.push(advisory);
          continue;
        }
        if (!advisory || !(advisory.severity in ranks)) return false;
        advisories++;
        if (ranks[advisory.severity] < ranks.moderate) continue;
        const patched = advisory.name === current && advisory.dependency === current && advisory.severity === 'high' && entry.nodes.every(location => {
          const patch = verified.get(location);
          return patch?.name === current && advisory.url === `https://github.com/advisories/${patch.advisory}`;
        });
        if (!patched) return false;
      }
    }
    return advisories > 0;
  };
  const blocked = entries.filter(([name, entry]) => ranks[entry.severity] >= ranks.moderate && !covered(name)).map(([name]) => name);
  if (blocked.length) throw new Error(`尚未修補的 npm 安全風險：${blocked.join('、')}`);
  return entries.filter(([, entry]) => ranks[entry.severity] >= ranks.moderate).length;
}

export function checkNpmSecurity() {
  const verified = dependencyPatches();
  const regression = spawnSync(process.execPath, ['--test', 'tests/dependency-security.test.mjs', 'tests/dependency-patches.test.mjs'], { cwd: mobileRoot, stdio: 'inherit' });
  if (regression.error || regression.status !== 0) throw new Error('依賴安全回歸測試失敗，停止發佈');
  const audit = spawnSync('npm', ['audit', '--json'], { cwd: mobileRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (audit.error || ![0, 1].includes(audit.status)) throw new Error('npm audit 執行失敗，停止發佈');
  const report = JSON.parse(audit.stdout);
  const count = validateAudit(report, verified);
  console.log(`PASS：npm 公告檢查通過；${count} 個中度以上依賴標記由已驗證的本機修補涵蓋，並非上游公告已解除。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) checkNpmSecurity();
