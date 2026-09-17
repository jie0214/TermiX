import { terminalStore } from './TerminalStore';
import {
  hasSessionLogPersisted,
  markSessionLogPersisted,
  trimSessionOutput,
  writeSessionLog
} from './SessionLogStore';

// 記錄「使用者主動關閉」的 session keys。
// 後端會提供關閉原因；前端仍預先標記，以涵蓋請求送出前就收到斷線事件的競態。
const userClosedSessionKeys = new Set();

export function markSessionUserClosed(sessionKey) {
  if (sessionKey) userClosedSessionKeys.add(sessionKey);
}

// 取出並清除標記：回傳 true 表示此關閉為使用者主動發起。
export function consumeUserClosed(sessionKey) {
  if (!sessionKey) return false;
  const wasUserClosed = userClosedSessionKeys.has(sessionKey);
  userClosedSessionKeys.delete(sessionKey);
  return wasUserClosed;
}

export function persistSessionLog(sessionKey) {
  if (hasSessionLogPersisted(sessionKey)) return null;
  const session = terminalStore.getState().sessions[sessionKey];
  if (!session || session.isLogView) return;

  const now = new Date();
  const config = session.config || {};
  const timestamp = Date.now();
  const outputHtml = trimSessionOutput(session.outputHtml);

  const record = {
    id: `log_${timestamp}_${Math.random().toString(36).slice(2, 9)}`,
    sessionKey,
    timestamp,
    dateStr: now.toLocaleDateString('zh-TW'),
    timeStr: now.toLocaleTimeString('zh-TW', { hour12: false }),
    userEmail: config.username || 'local-user',
    machineName: config.host || 'macOS',
    hostName: config.host || 'localhost',
    hostAlias: config.alias || session.label || config.host || 'Local',
    protocol: config.isLocal || session.isLocal ? 'local' : 'ssh',
    outputHtml
  };

  markSessionLogPersisted(sessionKey);
  return writeSessionLog(record);
}

export function cleanupFrontendSession(sessionKey, { persistLog = true } = {}) {
  const state = terminalStore.getState();
  if (persistLog) {
    persistSessionLog(sessionKey);
  }

  const term = state.xtermInstances[sessionKey];
  if (term) {
    term.dispose();
    terminalStore.getState().removeXtermInstance(sessionKey);
  }
  terminalStore.getState().removeBroadcastSession(sessionKey);
  terminalStore.getState().removeSession(sessionKey);
}
