import { sanitizeTerminalLogOutput } from './SessionLogStore.js';

// 連線狀態是純文字日誌；清理後補回 CRLF，讓 xterm 每行都回到行首。
// 僅用於連線摘要，不可套用於遠端 PTY 串流，以免改變游標控制行為。
export function formatTerminalBootstrapOutput(output) {
  const sanitized = sanitizeTerminalLogOutput(output).trim();
  return sanitized ? `${sanitized.replace(/\n/g, '\r\n')}\r\n\r\n` : '';
}
