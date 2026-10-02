// 共用靜態相依，確保瀏覽器測試與頁面使用同一份 Store。
export { TerminalPage } from '../src/modules/terminal/TerminalPage.js';
export { terminalStore } from '../src/modules/terminal/TerminalStore.js';
export * from '../src/modules/terminal/TerminalReconnect.js';
import '@xterm/xterm/css/xterm.css';
export { formatTerminalBootstrapOutput } from '../src/modules/terminal/TerminalOutput.js';
