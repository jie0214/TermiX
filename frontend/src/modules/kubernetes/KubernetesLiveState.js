// 保留未改變的物件參照，並以 UID 區別同名重建的資源。
const sections = new Set(['namespaceDetails', 'nodes', 'pods', 'deployments', 'statefulSets', 'daemonSets', 'services', 'events', 'jobs', 'cronJobs', 'ingresses', 'persistentVolumeClaims', 'persistentVolumes', 'storageClasses', 'configMaps', 'secrets', 'endpoints', 'networkPolicies', 'serviceAccounts', 'roles', 'roleBindings', 'clusterRoles', 'clusterRoleBindings', 'horizontalPodAutoscalers', 'podDisruptionBudgets', 'resourceQuotas', 'customResourceDefinitions']);
const key = item => `${item.namespace || ''}/${item.name}`;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeItem(previous, incoming, section) {
  if (!previous || (previous.uid && incoming.uid && previous.uid !== incoming.uid)) return incoming;
  const merged = (section === 'pods' || section === 'nodes')
    ? { ...incoming, ...(section === 'nodes' ? { metricsAvailable: previous.metricsAvailable === true } : {}), cpuUsageMilli: previous.cpuUsageMilli || 0, memoryUsageBytes: previous.memoryUsageBytes || 0 }
    : incoming;
  return equal(previous, merged) ? previous : merged;
}

export function applyKubernetesChanges(current, changes) {
  const dashboard = { ...current };
  const errors = { ...(current.resourceErrors || {}) };
  const liveErrors = {};
  for (const change of changes) {
    const { section, type, item } = change;
    if (section === 'metrics' && type === 'metrics') {
      dashboard.metrics = { ...dashboard.metrics, available: !change.error, error: change.error || '' };
      if (!change.error) {
        const values = new Map((change.items || []).map(value => [`${value.kind}/${key(value)}`, value]));
        for (const [name, kind] of [['pods', 'pod'], ['nodes', 'node']]) {
          dashboard[name] = (dashboard[name] || []).map(previous => {
            const value = values.get(`${kind}/${key(previous)}`);
            const next = { ...previous, ...(kind === 'node' ? { metricsAvailable: value?.metricsAvailable === true } : {}), cpuUsageMilli: value?.cpuUsageMilli || 0, memoryUsageBytes: value?.memoryUsageBytes || 0 };
            return equal(previous, next) ? previous : next;
          });
        }
      }
      continue;
    }
    if (!sections.has(section)) continue;
    if (type === 'status') {
      liveErrors[section] = change.error || '';
      continue;
    }
    const previous = dashboard[section] || [];
    if (type === 'reset') {
      const byName = new Map(previous.map(value => [key(value), value]));
      dashboard[section] = (change.items || []).map(value => mergeItem(byName.get(key(value)), value, section));
      delete errors[section];
    } else if (item && ['ADDED', 'MODIFIED', 'DELETED'].includes(type)) {
      const index = previous.findIndex(value => key(value) === key(item));
      if (type === 'DELETED') {
        // 舊 UID 的延遲刪除事件不可刪掉同名的新資源。
        dashboard[section] = previous.filter((value, i) => i !== index || (value.uid && item.uid && value.uid !== item.uid));
      } else {
        const next = mergeItem(previous[index], item, section);
        if (index < 0) dashboard[section] = [...previous, next];
        else if (next !== previous[index]) dashboard[section] = previous.map((value, i) => i === index ? next : value);
      }
    }
    if (dashboard[section] !== previous) {
      dashboard[section].sort(section === 'events'
        ? (a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || key(a).localeCompare(key(b))
        : (a, b) => key(a).localeCompare(key(b)));
      if (dashboard[section].length === previous.length && dashboard[section].every((value, i) => value === previous[i])) dashboard[section] = previous;
    }
  }
  dashboard.resourceErrors = equal(errors, current.resourceErrors || {}) ? current.resourceErrors : errors;
  const rows = name => dashboard[name] || [];
  const count = (name, field, value) => rows(name).filter(row => row[field] === value).length;
  dashboard.namespaces = rows('namespaceDetails').map(row => row.name).sort();
  if (equal(dashboard.namespaces, current.namespaces)) dashboard.namespaces = current.namespaces;
  dashboard.overview = {
    nodes: rows('nodes').length, readyNodes: count('nodes', 'status', 'Ready'),
    pods: rows('pods').length, runningPods: count('pods', 'phase', 'Running'), pendingPods: count('pods', 'phase', 'Pending'), failedPods: count('pods', 'phase', 'Failed'), succeededPods: count('pods', 'phase', 'Succeeded'),
    deployments: rows('deployments').length, readyDeployments: count('deployments', 'status', 'Ready'),
    statefulSets: rows('statefulSets').length, readyStatefulSets: count('statefulSets', 'status', 'Ready'),
    services: rows('services').length, warningEvents: count('events', 'type', 'Warning'),
  };
  if (equal(dashboard.overview, current.overview)) dashboard.overview = current.overview;
  dashboard.metrics = { ...dashboard.metrics };
  for (const field of ['cpuCapacityMilli', 'memoryCapacityBytes', 'cpuUsageMilli', 'memoryUsageBytes']) {
    dashboard.metrics[field] = rows('nodes').reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  }
  if (equal(dashboard.metrics, current.metrics)) dashboard.metrics = current.metrics;
  const changed = Object.keys(dashboard).some(name => dashboard[name] !== current[name]);
  return { dashboard: changed ? dashboard : current, liveErrors };
}
