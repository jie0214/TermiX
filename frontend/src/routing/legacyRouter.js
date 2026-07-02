import { kubernetesSessionStore, KUBERNETES_SESSION_ID } from '../modules/kubernetes/KubernetesSessionStore.js';
import { terminalStore } from '../modules/terminal/TerminalStore.js';
import {
  getHashRoutePath,
  LEGACY_VAADIN_ROUTES,
} from './routes.ts';

function syncTerminalWorkspace() {
  const state = terminalStore.getState();
  if (state.workspaces.length === 0) return;
  if (state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) return;

  const workspace = state.workspaces[0];
  const firstPane = workspace.columns[0]?.panes[0];
  terminalStore.getState().setActiveWorkspaceId(workspace.id);
  terminalStore.getState().setActivePaneSessionKey(firstPane?.sessionKey || null);
}

export function syncActiveWorkspaceFromRoute(pathname) {
  if (pathname === '/hosts' || pathname === '/control-panel') {
    terminalStore.getState().setActiveWorkspaceId('host-tab');
    return;
  }

  if (pathname === '/terminal') {
    syncTerminalWorkspace();
    return;
  }

  if (pathname === '/kubernetes-session' && kubernetesSessionStore.getState().session) {
    terminalStore.getState().setActiveWorkspaceId(KUBERNETES_SESSION_ID);
    terminalStore.getState().setActivePaneSessionKey(null);
  }
}

export function mountLegacyRouter(outlet) {
  const componentByPath = new Map(
    LEGACY_VAADIN_ROUTES.map((route) => [route.path, route.component]),
  );

  const renderCurrentRoute = () => {
    const pathname = getHashRoutePath();
    const componentName = componentByPath.get(pathname) || componentByPath.get('/hosts');
    syncActiveWorkspaceFromRoute(pathname);

    if (outlet.firstElementChild?.localName === componentName) return;
    outlet.replaceChildren(document.createElement(componentName));
  };

  window.addEventListener('hashchange', renderCurrentRoute);
  window.setTimeout(renderCurrentRoute, 0);

  return {
    dispose() {
      window.removeEventListener('hashchange', renderCurrentRoute);
    },
  };
}
