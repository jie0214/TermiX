const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const reactAppSource = read('frontend/src/ReactApp.tsx');
const legacyRouteShellSource = read('frontend/src/routing/LegacyRouteShell.tsx');
const errorBoundarySource = read('frontend/src/components/feedback/AppErrorBoundary.tsx');
const loadingStateSource = read('frontend/src/components/feedback/LoadingState.tsx');
const appSource = read('frontend/src/App.js');
const routesSource = read('frontend/src/routing/routes.ts');
const legacyRouterSource = read('frontend/src/routing/legacyRouter.js');

function assertContract(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

assertContract(
  reactAppSource.includes('HashRouter'),
  'React 根節點使用 HashRouter',
);
assertContract(
  legacyRouteShellSource.includes('useLocation') &&
    legacyRouteShellSource.includes('window.location.replace') &&
    legacyRouteShellSource.includes('DEFAULT_ROUTE_PATH'),
  'React Router 外殼以 hash replace 將未知路由導回預設頁面',
);
assertContract(
  legacyRouteShellSource.includes("createElement('termix-app')"),
  'React Router 外殼保留既有 termix-app Web Component',
);
assertContract(
  reactAppSource.includes("lazy(() => import('./routing/LegacyRouteShell'))"),
  '舊路由外殼使用 React lazy 建立獨立 chunk',
);
assertContract(
  reactAppSource.includes('<Suspense fallback={<LoadingState />}>'),
  '路由層使用共用 LoadingState 作為 Suspense fallback',
);
assertContract(
  reactAppSource.includes('<AppErrorBoundary>'),
  'React 根節點使用 Error Boundary 隔離渲染錯誤',
);
assertContract(
  errorBoundarySource.includes('getDerivedStateFromError') &&
    errorBoundarySource.includes('componentDidCatch'),
  'Error Boundary 捕捉 React render 與生命週期錯誤',
);
assertContract(
  errorBoundarySource.includes('window.location.reload()') &&
    errorBoundarySource.includes('window.location.replace'),
  'Error Boundary 提供重新載入與返回主機管理操作',
);
assertContract(
  loadingStateSource.includes('role="status"') &&
    loadingStateSource.includes('aria-live="polite"'),
  '共用載入狀態提供可及性語意',
);
assertContract(
  routesSource.includes("'/hosts'") &&
    routesSource.includes("'/terminal'") &&
    routesSource.includes("'/kubernetes-session'") &&
    routesSource.includes("'/control-panel'"),
  '共用路由定義涵蓋現有功能頁面',
);
assertContract(
  !routesSource.includes("path: '/'") && !routesSource.includes("path: '(.*)'"),
  '根路由與未知路由由 React Router 管理，不交由 Vaadin Router 改寫 URL',
);
assertContract(
  appSource.includes("import { mountLegacyRouter } from './routing/legacyRouter.js';"),
  'App 將舊頁面掛載委派給相容橋接層',
);
assertContract(
  !appSource.includes('@vaadin/router') && !legacyRouterSource.includes('@vaadin/router'),
  'React Router 外殼不再載入 Vaadin Router',
);
assertContract(
  legacyRouterSource.includes('syncActiveWorkspaceFromRoute'),
  '相容橋接層集中處理活動 Workspace 同步',
);
assertContract(
  legacyRouterSource.includes('outlet.replaceChildren(document.createElement(componentName))'),
  '相容橋接層依 hash 路徑掛載既有 Web Component 頁面',
);
assertContract(
  legacyRouterSource.includes("window.removeEventListener('hashchange', renderCurrentRoute)"),
  '相容橋接層提供 hashchange listener 清理',
);

console.log('=== React Router 相容外殼契約測試通過 ===');
