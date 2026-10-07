import assert from 'node:assert/strict';
import test from 'node:test';
import { eventFilterCounts, filterKubernetesEvents } from '../KubernetesEventFilters.js';
const events = [
  { type: 'Warning', reason: 'BackOff', namespace: 'payments', object: 'Pod/api', message: 'Restarting container' },
  { type: 'Normal', reason: 'Started', namespace: 'payments', object: 'Pod/api', message: 'Container started' },
  { type: 'Warning', reason: 'FailedScheduling', namespace: 'jobs', object: 'Pod/worker', message: 'Insufficient cpu' },
];
test('Event 按鈕顯示各類筆數，切換類型與搜尋條件可交集篩選', () => {
  assert.deepEqual(eventFilterCounts(events), { all: 3, Warning: 2, Normal: 1 });
  assert.equal(filterKubernetesEvents(events, 'Warning').length, 2);
  assert.deepEqual(filterKubernetesEvents(events, 'Warning', 'PAYMENTS'), [events[0]]);
  assert.deepEqual(filterKubernetesEvents(events, 'Normal', 'payments'), [events[1]]);
  assert.equal(filterKubernetesEvents(events, 'all', 'payments').length, 2);
  assert.equal(filterKubernetesEvents(events, 'Normal', 'cpu').length, 0);
  assert.deepEqual(eventFilterCounts([]), { all: 0, Warning: 0, Normal: 0 });
});
