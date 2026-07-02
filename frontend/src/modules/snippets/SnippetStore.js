import { createStore } from 'zustand/vanilla';

export const SNIPPETS_KEY = 'termix-snippets';
export const SNIPPET_PACKAGES_KEY = 'termix-snippet-packages';

export function createSnippetId(prefix = 'snip') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeSnippetPackage(pkg, index = 0) {
  return {
    id: String(pkg?.id || createSnippetId('pkg')),
    name: String(pkg?.name || 'Default Package').trim() || 'Default Package',
    order: Number.isFinite(Number(pkg?.order)) ? Number(pkg.order) : index
  };
}

export function normalizeSnippet(snippet, index = 0) {
  const packageId = snippet?.packageId || snippet?.package || '';
  return {
    id: String(snippet?.id || createSnippetId('snip')),
    name: String(snippet?.name || snippet?.description || 'Untitled Snippet').trim() || 'Untitled Snippet',
    description: String(snippet?.description || '').trim(),
    script: String(snippet?.script || '').replace(/\r\n/g, '\n'),
    packageId: packageId ? String(packageId) : '',
    package: packageId ? String(packageId) : '',
    targetHostIds: Array.isArray(snippet?.targetHostIds) ? snippet.targetHostIds.filter(Boolean) : [],
    createdAt: snippet?.createdAt || new Date().toISOString(),
    updatedAt: snippet?.updatedAt || new Date().toISOString(),
    order: Number.isFinite(Number(snippet?.order)) ? Number(snippet.order) : index
  };
}

export function toTerminalPayload(script, mode = 'run') {
  const normalized = String(script || '').replace(/\r\n/g, '\n');
  if (mode === 'paste') return normalized;
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    console.error(`Failed to read ${key}`, e);
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const snippetStore = createStore((set, get) => ({
  snippets: [],
  packages: [],
  selectedSnippet: null,
  editorOpen: false,

  loadSnippets: () => {
    const packages = readJson(SNIPPET_PACKAGES_KEY, []).map(normalizeSnippetPackage)
      .sort((a, b) => a.order - b.order);
    const snippets = readJson(SNIPPETS_KEY, []).map(normalizeSnippet)
      .sort((a, b) => a.order - b.order);
    set({ packages, snippets });
    writeJson(SNIPPET_PACKAGES_KEY, packages);
    writeJson(SNIPPETS_KEY, snippets);
  },

  setPackages: (packages) => {
    const normalized = (Array.isArray(packages) ? packages : []).map(normalizeSnippetPackage)
      .sort((a, b) => a.order - b.order)
      .map((pkg, order) => ({ ...pkg, order }));
    set({ packages: normalized });
    writeJson(SNIPPET_PACKAGES_KEY, normalized);
  },

  setSnippets: (snippets) => {
    const normalized = (Array.isArray(snippets) ? snippets : []).map(normalizeSnippet)
      .sort((a, b) => a.order - b.order)
      .map((snippet, order) => ({ ...snippet, order }));
    set({ snippets: normalized });
    writeJson(SNIPPETS_KEY, normalized);
  },

  addPackage: (name) => {
    const pkg = normalizeSnippetPackage({ id: createSnippetId('pkg'), name, order: get().packages.length });
    get().setPackages([...get().packages, pkg]);
    return pkg;
  },

  updatePackage: (id, fields) => {
    const next = get().packages.map((pkg) => (
      pkg.id === id
        ? normalizeSnippetPackage({ ...pkg, ...fields, id, order: pkg.order }, pkg.order)
        : pkg
    ));
    get().setPackages(next);
    return get().packages.find((pkg) => pkg.id === id) || null;
  },

  deletePackage: (id) => {
    const nextPackages = get().packages.filter((pkg) => pkg.id !== id);
    get().setPackages(nextPackages);
    get().setSnippets(get().snippets.map((snippet) => (
      snippet.packageId === id
        ? { ...snippet, packageId: '', package: '', updatedAt: new Date().toISOString() }
        : snippet
    )));
  },

  upsertSnippet: (snippet) => {
    const now = new Date().toISOString();
    const exists = get().snippets.some(item => item.id === snippet.id);
    const nextSnippet = normalizeSnippet({
      ...snippet,
      id: snippet.id || createSnippetId('snip'),
      createdAt: snippet.createdAt || now,
      updatedAt: now
    }, get().snippets.length);
    const next = exists
      ? get().snippets.map(item => item.id === nextSnippet.id ? nextSnippet : item)
      : [...get().snippets, nextSnippet];
    get().setSnippets(next);
    return nextSnippet;
  },

  deleteSnippet: (id) => {
    get().setSnippets(get().snippets.filter(item => item.id !== id));
  },

  saveTargets: (id, targetHostIds) => {
    const targets = Array.isArray(targetHostIds) ? targetHostIds.filter(Boolean) : [];
    get().setSnippets(get().snippets.map(item => (
      item.id === id ? { ...item, targetHostIds: targets, updatedAt: new Date().toISOString() } : item
    )));
  },

  setSelectedSnippet: (selectedSnippet) => set({ selectedSnippet }),
  setEditorOpen: (editorOpen) => set({ editorOpen })
}));
