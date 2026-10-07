import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './assets/tabler-icons.css';
import './app.css';
import { App } from './ReactApp';
import { installPlainTextInputs } from './runtime/plainTextInputs';
import { initializeApplication } from './runtime/initializeApplication';
import { t } from './i18n/index.ts';

const disposePlainTextInputs = installPlainTextInputs();
import.meta.hot?.dispose(disposePlainTextInputs);

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
