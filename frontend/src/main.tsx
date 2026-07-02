import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './app.css';
import { App } from './ReactApp';
import { initializeApplication } from './runtime/initializeApplication';
import { t } from './i18n/index.ts';

await initializeApplication();

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error(t('misc.app.rootNotFound'));
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
