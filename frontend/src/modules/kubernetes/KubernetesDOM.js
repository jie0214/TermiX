// 穩定的資源識別碼讓新增、刪除與排序只移動必要的列，不替換整張表。
function nodeKey(node) {
  if (node.nodeType !== 1) return '';
  if (node.dataset?.liveKey) return `live:${node.dataset.liveKey}`;
  if (node.id) return `id:${node.id}`;
  const data = node.dataset || {};
  if (data.resourceName) return `resource:${data.resourceKind}/${data.resourceNamespace}/${data.resourceName}`;
  if (data.eventRow) {
    try { const event = JSON.parse(decodeURIComponent(data.eventRow)); return `event:${event.uid || `${event.namespace}/${event.name}`}`; } catch { /* 使用結構比對 */ }
  }
  for (const name of ['section', 'navGroup', 'namespaceOption', 'detailTab', 'podAction', 'sortKey']) {
    if (data[name] !== undefined) return `${name}:${data[name]}`;
  }
  const cls = [...node.classList].find(name => name.startsWith('kubernetes-') && !['kubernetes-row-selected'].includes(name));
  return cls ? `${node.tagName}:${cls}` : '';
}

function compatible(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && nodeKey(a) === nodeKey(b);
}

const injected = node => node.nodeType === 1 && (node.classList.contains('kubernetes-select-th') || node.classList.contains('kubernetes-select-td'));

function patchNode(target, source, active) {
  if (target.nodeType !== 1) {
    if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
    return;
  }
  const editing = target === active || target.contains(active);
  // 非受控的 Forward 等表單也需保存使用者草稿，只有模板值改變時才同步。
  const oldValue = target.getAttribute('value');
  const selectValue = target.tagName === 'SELECT' ? target.value : null;
  const selectedDefault = target.tagName === 'SELECT' ? target.querySelector('option[selected]')?.value : null;
  const oldText = target.tagName === 'TEXTAREA' ? target.textContent : null;
  for (const attr of [...target.attributes]) {
    if (!source.hasAttribute(attr.name)) target.removeAttribute(attr.name);
  }
  for (const attr of [...source.attributes]) {
    if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value);
  }
  if (target.tagName === 'INPUT') {
    if (!editing && oldValue !== source.getAttribute('value')) target.value = source.value;
    if (target.type === 'checkbox' || target.type === 'radio') target.checked = source.checked;
    return;
  }
  if (target.tagName === 'TEXTAREA') {
    if (!editing && oldText !== source.textContent) target.value = source.value;
    if (!editing && oldText !== source.textContent) target.textContent = source.textContent;
    return;
  }
  patchChildren(target, source, active);
  if (target.tagName === 'SELECT') {
    const nextDefault = source.querySelector('option[selected]')?.value;
    const value = editing || selectedDefault === nextDefault ? selectValue : source.value;
    if ([...target.options].some(option => option.value === value)) target.value = value;
  }
}

function patchChildren(target, source, active) {
  const original = [...target.childNodes].filter(node => !injected(node));
  const keyed = new Map(original.filter(node => nodeKey(node)).map(node => [nodeKey(node), node]));
  const used = new Set();
  let cursor = target.firstChild;
  for (const incoming of [...source.childNodes]) {
    while (cursor && injected(cursor)) cursor = cursor.nextSibling;
    let node = cursor && compatible(cursor, incoming) ? cursor : (nodeKey(incoming) ? keyed.get(nodeKey(incoming)) : null);
    if (!node || used.has(node) || !compatible(node, incoming)) node = null;
    if (!node) {
      node = incoming.cloneNode(true);
      target.insertBefore(node, cursor);
    } else {
      if (node !== cursor) target.insertBefore(node, cursor);
      patchNode(node, incoming, active);
    }
    used.add(node);
    cursor = node.nextSibling;
  }
  for (const node of original) if (!used.has(node)) node.remove();
}

export function patchKubernetesDOM(root, html) {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  const active = root.ownerDocument.activeElement;
  const selection = active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
  patchChildren(root, template.content, active);
  if (active?.isConnected && root.contains(active) && root.ownerDocument.activeElement !== active) {
    active.focus({ preventScroll: true });
    if (selection) active.setSelectionRange(...selection);
  }
}
