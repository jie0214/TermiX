import { createStore } from 'zustand/vanilla';
import { hostStore } from '../hostvault/HostStore';

const CUSTOM_COMPONENTS_KEY = 'termix-custom-components';

function isValidControlPanelComponent(comp) {
  return comp && comp.id && ['info', 'switch', 'function'].includes(comp.type);
}

function cleanupHostComponentReferences(validComponents) {
  const validIds = new Set(validComponents.map(comp => comp.id));
  const hosts = hostStore.getState().hosts || [];
  hosts.forEach((host) => {
    const customComponents = Array.isArray(host.config?.customComponents)
      ? host.config.customComponents
      : [];
    const mountedComponents = customComponents
      .filter(item => item && item.id && item.visible && validIds.has(item.id))
      .map((item, idx) => ({ id: item.id, visible: true, order: item.order ?? idx }))
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
      .map((item, idx) => ({ ...item, order: idx }));

    const changed = mountedComponents.length !== customComponents.length
      || mountedComponents.some((item, idx) => {
        const prev = customComponents[idx];
        return !prev || prev.id !== item.id || prev.order !== item.order;
      });

    if (!changed) return;

    hostStore.getState().updateHost(host.id, {
      config: {
        ...(host.config || {}),
        customComponents: mountedComponents
      }
    }).catch((e) => {
      console.error('Failed to cleanup host Control Panel references', e);
    });
  });
}

export const controlPanelStore = createStore((set, get) => ({
  components: [],
  drawerOpen: false,
  selectedComponent: null,

  // 載入與初始化資料
  loadComponents: () => {
    try {
      const rawComponents = localStorage.getItem(CUSTOM_COMPONENTS_KEY);
      const components = rawComponents ? JSON.parse(rawComponents) : [];
      const validComponents = (Array.isArray(components) ? components : []).filter(isValidControlPanelComponent);
      set({ components: validComponents });
      localStorage.setItem(CUSTOM_COMPONENTS_KEY, JSON.stringify(validComponents));
      cleanupHostComponentReferences(validComponents);
    } catch (e) {
      console.error('Failed to load Custom Components from localStorage', e);
    }
  },

  // 狀態 actions
  setComponents: (components) => {
    const validComponents = (Array.isArray(components) ? components : []).filter(isValidControlPanelComponent);
    set({ components: validComponents });
    localStorage.setItem(CUSTOM_COMPONENTS_KEY, JSON.stringify(validComponents));
    cleanupHostComponentReferences(validComponents);
  },

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setSelectedComponent: (selectedComponent) => set({ selectedComponent }),

  // 業務 helper actions
  addComponent: (comp) => {
    const nextComponents = [...get().components, comp];
    get().setComponents(nextComponents);
  },

  updateComponent: (id, updatedFields) => {
    const nextComponents = get().components.map(c => c.id === id ? { ...c, ...updatedFields } : c);
    get().setComponents(nextComponents);
  },

  deleteComponent: (id) => {
    const nextComponents = get().components.filter(c => c.id !== id);
    get().setComponents(nextComponents);
  }
}));
