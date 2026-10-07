export function eventFilterCounts(events) {
  return {
    all: events.length,
    Warning: events.filter(event => event.type === 'Warning').length,
    Normal: events.filter(event => event.type === 'Normal').length,
  };
}

export function filterKubernetesEvents(events, type = 'all', query = '') {
  const search = query.trim().toLowerCase();
  return events.filter(event => {
    if (type !== 'all' && event.type !== type) return false;
    return !search || `${event.reason || ''} ${event.namespace || ''} ${event.object || event.involvedObject || ''} ${event.message || ''}`.toLowerCase().includes(search);
  });
}
