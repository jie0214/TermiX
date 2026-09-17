const SESSION_LOG_KEY = 'termix-session-logs';
const MAX_SESSION_LOGS = 50;
const MAX_OUTPUT_LENGTH = 50000;
const SESSION_LOG_COMPACTION_THRESHOLD = 500000;
const RECOVERY_MAX_SESSION_LOGS = 15;
const RECOVERY_MAX_OUTPUT_LENGTH = 5000;
const LOGS_CHANGED_EVENT = 'termix-session-logs-changed';

const persistedSessionKeys = new Set();

function dispatchLogsChanged() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(LOGS_CHANGED_EVENT));
  }
}

function redactSensitiveAssignments(text) {
  return String(text || '')
    .replace(
      /((?:^|\s|["'{,])(?:password|passphrase|token|secret|authorization|api[_-]?key|access[_-]?key|secret[_-]?key|aws_secret_access_key|aws_session_token)(?:["'}\]]|\b)?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,\]}]+)/gim,
      '$1[REDACTED]'
    )
    .replace(
      /("(?:password|passphrase|token|secret|authorization|api[_-]?key|access[_-]?key|secret[_-]?key|aws_secret_access_key|aws_session_token)"\s*:\s*)"(?:[^"\\]|\\.)*"/gim,
      '$1"[REDACTED]"'
    );
}

function stripTermixExecutionMarkers(text) {
  return String(text || '')
    .replace(/^.*__TERMIX_(?:START|DONE)_\d+__.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeRecord(record, index) {
  if (!record || typeof record !== 'object') return null;
  const timestamp = Number(record.timestamp) || Date.parse(`${record.dateStr || ''} ${record.timeStr || ''}`) || index;
  return {
    ...record,
    timestamp,
    outputHtml: sanitizeTerminalLogOutput(record.outputHtml)
  };
}

function isQuotaExceededError(error) {
  return error?.name === 'QuotaExceededError'
    || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error?.code === 22;
}

function compactSessionLogs(logs) {
  return logs.slice(0, RECOVERY_MAX_SESSION_LOGS).map((log) => ({
    ...log,
    outputHtml: String(log?.outputHtml || '').slice(-RECOVERY_MAX_OUTPUT_LENGTH)
  }));
}

function persistSessionLogs(logs) {
  try {
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(logs));
    return logs;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    const compactLogs = compactSessionLogs(logs);
    console.warn('[TermiX] Session Logs 已達儲存上限，改以壓縮紀錄保存。');
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(compactLogs));
    return compactLogs;
  }
}

export function readSessionLogs() {
  try {
    const raw = localStorage.getItem(SESSION_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRecord)
      .filter(Boolean)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch (err) {
    console.warn('[TermiX] Failed to read session logs', err);
    return [];
  }
}

export function trimSessionOutput(output) {
  const rawOutput = sanitizeTerminalLogOutput(output);
  return rawOutput.length > MAX_OUTPUT_LENGTH
    ? rawOutput.slice(rawOutput.length - MAX_OUTPUT_LENGTH)
    : rawOutput;
}

export function compactStoredSessionLogs() {
  try {
    const raw = localStorage.getItem(SESSION_LOG_KEY);
    if (!raw || raw.length <= SESSION_LOG_COMPACTION_THRESHOLD) return false;
    const logs = readSessionLogs();
    if (logs.length === 0) return false;
    persistSessionLogs(compactSessionLogs(logs));
    dispatchLogsChanged();
    return true;
  } catch (error) {
    console.warn('[TermiX] 無法壓縮 Session Logs', error);
    return false;
  }
}

export function sanitizeTerminalLogOutput(output) {
  let text = String(output || '');
  text = text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\n\t]+$/gm, '');

  const chars = [];
  for (const char of text) {
    if (char === '\b') {
      if (chars.length > 0 && chars[chars.length - 1] !== '\n') {
        chars.pop();
      }
    } else {
      chars.push(char);
    }
  }
  text = chars.join('');
  text = stripTermixExecutionMarkers(text);
  text = redactSensitiveAssignments(text);

  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function writeSessionLog(record) {
  if (!record || !record.id) return null;
  const logs = readSessionLogs().filter((item) => item.id !== record.id);
  const normalized = normalizeRecord(record, Date.now());
  if (!normalized) return null;
  const nextLogs = [normalized, ...logs]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, MAX_SESSION_LOGS);
  persistSessionLogs(nextLogs);
  dispatchLogsChanged();
  return normalized;
}

export function clearSessionLogs(activeSessions = {}) {
  localStorage.removeItem(SESSION_LOG_KEY);
  persistedSessionKeys.clear();
  Object.values(activeSessions || {}).forEach((session) => {
    if (session && !session.isLogView) {
      session.outputHtml = '';
    }
  });
  dispatchLogsChanged();
}

export function deleteSessionLogs(ids = []) {
  const targetIds = new Set(Array.isArray(ids) ? ids.filter(Boolean) : []);
  if (targetIds.size === 0) return readSessionLogs();
  const nextLogs = readSessionLogs().filter((log) => !targetIds.has(log.id));
  let persistedLogs = nextLogs;
  if (nextLogs.length === 0) {
    localStorage.removeItem(SESSION_LOG_KEY);
  } else {
    persistedLogs = persistSessionLogs(nextLogs);
  }
  dispatchLogsChanged();
  return persistedLogs;
}

export function hasSessionLogPersisted(sessionKey) {
  return persistedSessionKeys.has(sessionKey);
}

export function markSessionLogPersisted(sessionKey) {
  if (sessionKey) persistedSessionKeys.add(sessionKey);
}

export { SESSION_LOG_KEY, MAX_SESSION_LOGS, MAX_OUTPUT_LENGTH, LOGS_CHANGED_EVENT };
