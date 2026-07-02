import { createStore } from 'zustand/vanilla';
import { KubernetesAPI } from './KubernetesAPI.js';
import {
  assertValidKubernetesCluster,
  createKubernetesClusterDraft,
  getAvailableKubernetesUsers,
  normalizeKubernetesCluster,
  normalizeKubernetesClusters
} from './KubernetesModel.js';
import { t } from '../../i18n/index.ts';

function resolveSavedCluster(result, fallback) {
  if (result && typeof result === 'object') {
    return normalizeKubernetesCluster(result);
  }
  return normalizeKubernetesCluster(fallback);
}

export const kubernetesStore = createStore((set, get) => ({
  clusters: [],
  availableUsers: [],
  users: [],
  selectedCluster: null,
  drawerOpen: false,
  isLoading: false,
  loadError: '',
  switchingContext: '',

  applyClusters: (payload) => {
    const clusters = normalizeKubernetesClusters(payload);
    const availableUsers = getAvailableKubernetesUsers(clusters);
    const selectedId = get().selectedCluster?.id;
    const selectedCluster = selectedId
      ? clusters.find(cluster => cluster.id === selectedId) || null
      : get().selectedCluster;
    set({ clusters, availableUsers, users: availableUsers, selectedCluster });
    return clusters;
  },

  load: async () => {
    set({ isLoading: true, loadError: '' });
    try {
      const clusters = get().applyClusters(await KubernetesAPI.listClusters());
      set({ isLoading: false });
      return clusters;
    } catch (error) {
      set({ isLoading: false, loadError: error?.message || String(error) });
      throw error;
    }
  },

  reload: async () => get().load(),
  loadFromBackend: async () => get().load(),
  loadClusters: async () => get().load(),
  reloadClusters: async () => get().reload(),

  openCreateDrawer: () => set({
    selectedCluster: createKubernetesClusterDraft(),
    drawerOpen: true
  }),

  openEditDrawer: (cluster) => set({
    selectedCluster: normalizeKubernetesCluster(cluster),
    drawerOpen: true
  }),

  closeDrawer: () => set({ drawerOpen: false, selectedCluster: null }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setSelectedCluster: (selectedCluster) => set({ selectedCluster }),

  save: async (profile) => {
    const validated = assertValidKubernetesCluster(profile || get().selectedCluster || {});
    const isDraft = validated.id.startsWith('k8s_draft_');
    const payload = isDraft ? { ...validated, id: '' } : validated;
    const result = await KubernetesAPI.saveCluster(payload);
    const saved = resolveSavedCluster(result, payload);
    await get().reload();
    const persisted = get().clusters.find(cluster => cluster.id === saved.id)
      || get().clusters.find(cluster => cluster.contextName === saved.contextName)
      || saved;
    set({ selectedCluster: persisted, drawerOpen: false });
    return persisted;
  },

  saveCluster: async (profile) => get().save(profile),

  delete: async (id) => {
    if (!id) throw new Error(t('k8s.err.missingDeleteClusterId'));
    await KubernetesAPI.deleteCluster(id);
    const clusters = get().clusters.filter(cluster => cluster.id !== id);
    const availableUsers = getAvailableKubernetesUsers(clusters);
    set({
      clusters,
      availableUsers,
      users: availableUsers,
      selectedCluster: get().selectedCluster?.id === id ? null : get().selectedCluster,
      drawerOpen: get().selectedCluster?.id === id ? false : get().drawerOpen
    });
    return clusters;
  },

  deleteCluster: async (id) => get().delete(id),

  switch: async (clusterId) => {
    const targetId = String(clusterId || '').trim();
    if (!targetId) throw new Error(t('k8s.err.missingSwitchClusterId'));
    const cluster = get().clusters.find(item => item.id === targetId);
    if (!cluster) throw new Error(t('k8s.err.clusterNotFound', { id: targetId }));
    set({ switchingContext: targetId, loadError: '' });
    try {
      await KubernetesAPI.switchContext({
        contextName: cluster.contextName,
        kubeconfigPath: cluster.kubeconfigPath
      });
      const clusters = await get().reload();
      return clusters.find(item => item.id === targetId)
        || clusters.find(item => item.contextName === cluster.contextName && item.kubeconfigPath === cluster.kubeconfigPath)
        || null;
    } catch (error) {
      set({ loadError: error?.message || String(error) });
      throw error;
    } finally {
      set({ switchingContext: '' });
    }
  },

  switchContext: async (clusterId) => get().switch(clusterId)
}));
