import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './app.css';
import { App } from './ReactApp';
import { initializeApplication } from './runtime/initializeApplication';

await initializeApplication();

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('找不到 TermiX 前端根節點「#app」。');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
