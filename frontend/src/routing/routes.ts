export const DEFAULT_ROUTE_PATH = '/hosts';

export const APP_ROUTE_PATHS = [
  '/hosts',
  '/terminal',
  '/kubernetes-session',
  '/control-panel',
] as const;

export type AppRoutePath = (typeof APP_ROUTE_PATHS)[number];

export const LEGACY_VAADIN_ROUTES = [
  { path: '/hosts', component: 'host-list-page' },
  { path: '/terminal', component: 'terminal-page' },
  { path: '/kubernetes-session', component: 'kubernetes-session-page' },
  { path: '/control-panel', component: 'control-panel-page' },
] as const;

export function isAppRoutePath(pathname: string): pathname is AppRoutePath {
  return APP_ROUTE_PATHS.includes(pathname as AppRoutePath);
}

export function getHashRoutePath(hash = window.location.hash): string {
  const hashPath = hash.startsWith('#') ? hash.slice(1) : hash;
  const pathname = hashPath.split(/[?#]/, 1)[0];
  return pathname || DEFAULT_ROUTE_PATH;
}
