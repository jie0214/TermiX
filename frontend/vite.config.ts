import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 固定 dev server port，避免 port 漂移導致 webview origin 改變、
  // localStorage（Control Panel 元件 / Snippets 等）在開發模式看似「消失」。
  server: {
    port: 5173,
    strictPort: true,
  },
});
