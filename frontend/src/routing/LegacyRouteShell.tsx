import { createElement, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { DEFAULT_ROUTE_PATH, isAppRoutePath } from './routes';

export default function LegacyRouteShell() {
  const location = useLocation();
  const requiresRedirect =
    location.pathname === '/' || !isAppRoutePath(location.pathname);

  useEffect(() => {
    if (requiresRedirect) {
      window.location.replace(`#${DEFAULT_ROUTE_PATH}`);
    }
  }, [requiresRedirect]);

  return createElement('termix-app');
}
