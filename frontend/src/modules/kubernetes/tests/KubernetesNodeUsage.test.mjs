import assert from 'node:assert/strict';
import test from 'node:test';
import { renderNodeUsage } from '../KubernetesNodeUsage.js';

const format = value => `${value}m`;
test('Node 使用率顯示容量比例、用量與零使用量', () => {
  assert.match(renderNodeUsage(1000, 4000, true, format), /25\.0%/);
  assert.match(renderNodeUsage(1000, 4000, true, format), /1000m \/ 4000m/);
  assert.match(renderNodeUsage(0, 4000, true, format), /0\.0%/);
  assert.match(renderNodeUsage(750, 1000, true, format), /color-warning/);
  const over = renderNodeUsage(1100, 1000, true, format);
  assert.match(over, /110\.0%/);
  assert.match(over, /width:100%;/);
  assert.match(over, /color-danger/);
});
test('缺少樣本或有效容量時不顯示誤導的 0%', () => {
  for (const args of [[0, 1000, false], [1, 0, true], [undefined, 1000, true]]) {
    const html = renderNodeUsage(...args, format);
    assert.match(html, /無資料/);
    assert.doesNotMatch(html, /%/);
  }
});
