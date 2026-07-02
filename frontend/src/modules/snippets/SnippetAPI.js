// @ts-check
import {
  createSnippetId,
  normalizeSnippet,
  normalizeSnippetPackage,
  SNIPPETS_KEY,
  SNIPPET_PACKAGES_KEY
} from './SnippetStore';

/**
 * @typedef {ReturnType<typeof normalizeSnippet>} Snippet
 * @typedef {ReturnType<typeof normalizeSnippetPackage>} SnippetPackage
 */

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    console.error(`Failed to read ${key}`, error);
    return fallback;
  }
}

/**
 * @template T
 * @param {string} key
 * @param {T} value
 * @returns {T}
 */
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}

/**
 * @returns {SnippetPackage[]}
 */
function readPackages() {
  return readJson(SNIPPET_PACKAGES_KEY, /** @type {unknown[]} */ ([]))
    .map(normalizeSnippetPackage)
    .sort((left, right) => left.order - right.order);
}

/**
 * @returns {Snippet[]}
 */
function readSnippets() {
  return readJson(SNIPPETS_KEY, /** @type {unknown[]} */ ([]))
    .map(normalizeSnippet)
    .sort((left, right) => left.order - right.order);
}

/**
 * @param {unknown} packages
 * @returns {SnippetPackage[]}
 */
function writePackages(packages) {
  return writeJson(SNIPPET_PACKAGES_KEY, (Array.isArray(packages) ? packages : [])
    .map(normalizeSnippetPackage)
    .sort((left, right) => left.order - right.order)
    .map((pkg, order) => ({ ...pkg, order })));
}

/**
 * @param {unknown} snippets
 * @returns {Snippet[]}
 */
function writeSnippets(snippets) {
  return writeJson(SNIPPETS_KEY, (Array.isArray(snippets) ? snippets : [])
    .map(normalizeSnippet)
    .sort((left, right) => left.order - right.order)
    .map((snippet, order) => ({ ...snippet, order })));
}

export const SnippetAPI = {
  listPackages() {
    return readPackages();
  },

  listSnippets() {
    return readSnippets();
  },

  /** @param {string} snippetId */
  getSnippet(snippetId) {
    return readSnippets().find((snippet) => snippet.id === snippetId) || null;
  },

  /** @param {Record<string, any>} [payload] */
  createPackage(payload = {}) {
    const packages = readPackages();
    const nextPackage = normalizeSnippetPackage({
      id: createSnippetId('pkg'),
      name: payload.name || 'New Package',
      order: packages.length
    }, packages.length);
    writePackages([...packages, nextPackage]);
    return nextPackage;
  },

  /**
   * @param {string} packageId
   * @param {Record<string, any>} [payload]
   */
  updatePackage(packageId, payload = {}) {
    const packages = readPackages().map((pkg) => (
      pkg.id === packageId
        ? normalizeSnippetPackage({ ...pkg, ...payload, id: packageId, order: pkg.order }, pkg.order)
        : pkg
    ));
    writePackages(packages);
    return readPackages().find((pkg) => pkg.id === packageId) || null;
  },

  /** @param {string} packageId */
  deletePackage(packageId) {
    writePackages(readPackages().filter((pkg) => pkg.id !== packageId));
    writeSnippets(readSnippets().map((snippet) => (
      snippet.packageId === packageId
        ? { ...snippet, packageId: '', package: '', updatedAt: new Date().toISOString() }
        : snippet
    )));
  },

  /**
   * @param {string} snippetId
   * @param {string[]} hostIds
   */
  saveTargets(snippetId, hostIds) {
    const uniqueHostIds = Array.from(new Set((Array.isArray(hostIds) ? hostIds : []).filter(Boolean)));
    const nextSnippets = readSnippets().map((snippet) => (
      snippet.id === snippetId
        ? { ...snippet, targetHostIds: uniqueHostIds, updatedAt: new Date().toISOString() }
        : snippet
    ));
    writeSnippets(nextSnippets);
    return uniqueHostIds;
  },

  /** @param {Record<string, any>} [config] */
  resolveStartupCommand(config = {}) {
    if (config.startupCommandMode === 'manual') {
      return String(config.startupCommandText || '').trim();
    }
    if (config.startupCommandMode === 'snippet') {
      return String(this.getSnippet(config.startupSnippetId)?.script || '').trim();
    }
    if (Array.isArray(config.startupSnippetIds) && config.startupSnippetIds.length > 0) {
      return String(this.getSnippet(config.startupSnippetIds[0])?.script || '').trim();
    }
    return '';
  }
};
