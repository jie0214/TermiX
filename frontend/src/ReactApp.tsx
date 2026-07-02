import { lazy, Suspense } from 'react';
import {
  HashRouter,
  Route,
  Routes,
} from 'react-router-dom';

import { AppErrorBoundary } from './components/feedback/AppErrorBoundary';
import { LoadingState } from './components/feedback/LoadingState';

const LegacyRouteShell = lazy(() => import('./routing/LegacyRouteShell'));

/**
 * React 遷移邊界。
 *
 * 現階段由 React 管理應用程式根節點，既有功能仍由 termix-app Web Component
 * 提供。後續可依功能模組逐步替換內部頁面，不需要一次重寫所有工作區流程。
 */
export function App() {
  return (
    <AppErrorBoundary>
      <HashRouter>
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="*" element={<LegacyRouteShell />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AppErrorBoundary>
  );
}
