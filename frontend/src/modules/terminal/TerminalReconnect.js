import { terminalStore } from './TerminalStore';
import { TerminalAPI } from './TerminalAPI';
import { formatTerminalBootstrapOutput } from './TerminalOutput.js';
import { consumeUserClosed } from './TerminalLifecycle';
import { t } from '../../i18n/index.ts';

// ============================================================================
// L3：SSH session 異常斷線的自動 / 一鍵重連 + 輸入暫存
// ----------------------------------------------------------------------------
// 設計要點（狀態機）：
//   - 只處理「異常斷線」（非使用者主動關閉）且為「可重連的遠端 SSH」的 session。
//   - 異常斷線時「不」立即從 workspace 移除 pane，改為就地在該 pane 顯示斷線狀態，
//     先自動重試 1 次；失敗則顯示「一鍵重連」按鈕，讓使用者手動重試。
//   - 重連成功後會產生「新的 sessionKey」，需把 pane 綁定、xterm 實例、sessions 映射
//     從舊 key 平滑遷移到新 key，使用者仍看到同一個 pane（且沿用同一個 xterm 實例，
//     保留原本 scrollback）。
//   - 防重複：以 module 內的 Set 保證同一個 sessionKey 同時只有一個重連流程在進行；
//     且重連流程開始時即從 workspace 記下 pane 位置，避免競態。
//   - 輸入暫存採「保守版」：斷線視窗期間使用者於該 pane 的輸入先暫存，重連成功後
//     不自動送出，改在 pane overlay 顯示「待送出輸入」讓使用者確認送出或捨棄，
//     避免把半截指令誤送到剛連上的新 shell。
// ============================================================================

// 正在重連中的 sessionKey（防止同一 pane 併發重連）。
const reconnectingKeys = new Set();

// 每個斷線 pane 的重連上下文，鍵為「當前 pane 綁定的 sessionKey」。
// 重連成功後會遷移到新的 sessionKey。
// 結構：{ key, wsId, target, label, status, attempts, pendingInput }
const reconnectContexts = new Map();

const MAX_OUTPUT_LENGTH = 200000;

/**
 * 判斷此 session 是否為「可重連的遠端 SSH」。
 * 本機終端、日誌回放、缺乏重連資訊者一律不重連。
 * @param {any} session terminalStore.sessions[key]
 * @returns {boolean}
 */
export function isReconnectableSession(session) {
  if (!session) return false;
  if (session.isLogView || session.isKubernetesShell) return false;
  if (session.isLocal) return false;
  const cfg = session.config || {};
  if (cfg.isLocal) return false;
  // 需具備足夠重連資訊：hostId 或至少 host（走 connectTerminal(config)）。
  return Boolean(cfg.hostId || cfg.host);
}

/**
 * 由 session.config 組出可傳給 TerminalAPI.connectTarget 的重連 target。
 * 每次重連指派全新的 sessionId，避免與舊連線的 session 記錄衝突。
 * @param {any} session
 * @returns {{ hostId?: string, config: any }}
 */
function buildReconnectTarget(session) {
  const cfg = { ...(session.config || {}) };
  const newSessionId =
    'reconnect_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  cfg.sessionId = newSessionId;
  return {
    hostId: cfg.hostId || '',
    config: cfg,
    displayConfig: cfg
  };
}

/**
 * 在 workspaces 中尋找某 sessionKey 所在的 workspace id 與 pane 位置。
 * @param {string} sessionKey
 * @returns {{ wsId: string } | null}
 */
function locatePane(sessionKey) {
  const state = terminalStore.getState();
  for (const ws of state.workspaces) {
    for (const col of ws.columns) {
      for (const pane of col.panes) {
        if (pane.sessionKey === sessionKey) {
          return { wsId: ws.id };
        }
      }
    }
  }
  return null;
}

// 後端會先啟動 PTY 串流，才回傳連線結果；以每次嘗試的 sessionId 接住早到事件。
function findConnectingContext(sessionKey) {
  return [...reconnectContexts.values()].find(ctx =>
    ctx.inFlight && typeof sessionKey === 'string' &&
    sessionKey.endsWith('|' + ctx.target.config.sessionId));
}

export function bufferReconnectOutput(sessionKey, chunk) {
  const ctx = findConnectingContext(sessionKey);
  if (!ctx || typeof chunk !== 'string') return false;
  ctx.earlyOutput = (ctx.earlyOutput + chunk).slice(-MAX_OUTPUT_LENGTH);
  return true;
}

export function handleReconnectClosed(sessionKey) {
  if (reconnectingKeys.has(sessionKey)) return true;
  const ctx = findConnectingContext(sessionKey);
  if (!ctx) return false;
  ctx.connectionClosed = true;
  return true;
}

/**
 * 判斷某 sessionKey 目前是否處於重連流程中。
 * @param {string} sessionKey
 * @returns {boolean}
 */
export function isReconnecting(sessionKey) {
  return reconnectingKeys.has(sessionKey);
}

/**
 * 取得指定 sessionKey 的重連上下文（供 UI 層讀取暫存輸入等）。
 * @param {string} sessionKey
 */
export function getReconnectContext(sessionKey) {
  return reconnectContexts.get(sessionKey) || null;
}

/**
 * 於斷線視窗期間暫存使用者在該 pane 的輸入（保序、不去重是刻意的：
 * 我們保留原始輸入序列，最終由使用者確認是否送出）。
 * @param {string} sessionKey
 * @param {string} data
 */
export function bufferReconnectInput(sessionKey, data) {
  const ctx = reconnectContexts.get(sessionKey);
  if (!ctx) return;
  if (typeof data !== 'string' || data.length === 0) return;
  ctx.pendingInput = (ctx.pendingInput || '') + data;
  // 上限保護，避免長時間斷線 + 狂敲鍵盤造成無限成長。
  const MAX_PENDING = 8192;
  if (ctx.pendingInput.length > MAX_PENDING) {
    ctx.pendingInput = ctx.pendingInput.slice(ctx.pendingInput.length - MAX_PENDING);
  }
}

/**
 * 啟動一個異常斷線 session 的重連流程。
 * 僅在「非使用者主動關閉」且「可重連」時由呼叫端進入此函式。
 *
 * @param {string} sessionKey 斷線的 sessionKey
 * @param {{
 *   onStatus?: (sessionKey: string, status: 'connecting'|'failed'|'success', ctx: any) => void
 * }} [hooks] UI 回呼；狀態改變時通知呼叫端更新 pane overlay。
 * @returns {boolean} 是否成功進入重連流程（false 表示不符合條件）。
 */
export function beginReconnect(sessionKey, hooks = {}) {
  if (!sessionKey) return false;
  if (reconnectingKeys.has(sessionKey)) return true;

  const state = terminalStore.getState();
  const session = state.sessions[sessionKey];
  if (!isReconnectableSession(session)) return false;

  const located = locatePane(sessionKey);
  if (!located) return false; // pane 已不存在，不重連。

  const cfg = session.config || {};
  const label = cfg.alias || session.label || cfg.host || sessionKey;

  const ctx = {
    key: sessionKey,
    wsId: located.wsId,
    target: buildReconnectTarget(session),
    session,
    label,
    attempts: 0,
    autoRetried: false,
    pendingInput: '',
    hooks
  };
  reconnectContexts.set(sessionKey, ctx);
  reconnectingKeys.add(sessionKey);

  // 立即嘗試第一次（自動）。
  runReconnectAttempt(ctx, { auto: true });
  return true;
}

/**
 * 使用者手動觸發的一鍵重連。
 * @param {string} sessionKey 目前 pane 綁定（斷線中）的 sessionKey
 * @returns {boolean}
 */
export function retryReconnect(sessionKey) {
  const ctx = reconnectContexts.get(sessionKey);
  if (!ctx) return false;
  if (ctx.inFlight) return false;
  runReconnectAttempt(ctx, { auto: false });
  return true;
}

/**
 * 放棄重連：清理上下文與該 session 的前端資料，並把 pane 從 workspace 移除。
 * 由 UI 的「取消 / 關閉」按鈕呼叫。回傳被移除的 sessionKey（供呼叫端做路由）。
 * @param {string} sessionKey
 * @returns {string|null}
 */
export function abortReconnect(sessionKey) {
  const ctx = reconnectContexts.get(sessionKey);
  if (!ctx) return null;
  reconnectContexts.delete(sessionKey);
  reconnectingKeys.delete(sessionKey);
  if (ctx.inFlight) {
    Promise.resolve().then(() => TerminalAPI.cancelConnectTarget(ctx.target)).catch(() => {});
  }
  return sessionKey;
}

/**
 * 執行單次重連嘗試。
 * @param {any} ctx
 * @param {{ auto: boolean }} opts
 */
async function runReconnectAttempt(ctx, opts) {
  if (ctx.inFlight) return;
  ctx.target = buildReconnectTarget(ctx.session);
  ctx.earlyOutput = '';
  ctx.connectionClosed = false;
  ctx.inFlight = true;
  ctx.attempts += 1;
  if (opts.auto) ctx.autoRetried = true;

  notify(ctx, 'connecting');

  let res = null;
  let err = null;
  try {
    res = await TerminalAPI.connectTarget(ctx.target);
  } catch (e) {
    err = e;
  }

  ctx.inFlight = false;

  // 重連進行中若 pane 已被關閉或上下文已被放棄，
  // 則清掉剛建立的新連線並終止流程，避免產生孤兒 session。
  const stillTracking = reconnectContexts.get(ctx.key) === ctx;
  if (!stillTracking || !locatePane(ctx.key) || !terminalStore.getState().sessions[ctx.key]) {
    if (stillTracking) abortReconnect(ctx.key);
    if (res && res.success && res.sessionKey) {
      TerminalAPI.closeTerminalSession(res.sessionKey).catch(() => {});
    }
    return;
  }

  if (err || !res || !res.success || !res.sessionKey || ctx.connectionClosed) {
    notify(ctx, 'failed');
    return;
  }

  finalizeReconnect(ctx, res);
}

/**
 * 重連成功：把 pane / xterm / sessions 由舊 key 遷移到新 key。
 * @param {any} ctx
 * @param {{ sessionKey: string, output?: string, isSudo?: boolean }} res
 */
function finalizeReconnect(ctx, res) {
  const oldKey = ctx.key;
  const newKey = res.sessionKey;
  const state = terminalStore.getState();
  const oldSession = state.sessions[oldKey];
  const term = state.xtermInstances[oldKey];
  const banner = '\r\n\x1b[32m' + t('terminal.reconnectedBanner') + '\x1b[0m\r\n';
  const bootOutput = formatTerminalBootstrapOutput(res.output) + ctx.earlyOutput;
  const sessions = { ...state.sessions };
  const xtermInstances = { ...state.xtermInstances };
  const sessionHistories = { ...state.sessionHistories };
  const broadcastInputSessions = new Set(state.broadcastInputSessions);
  delete sessions[oldKey];
  delete xtermInstances[oldKey];
  delete sessionHistories[oldKey];
  sessions[newKey] = {
    ...oldSession,
    config: { ...oldSession.config, sessionId: ctx.target.config.sessionId },
    outputHtml: ((oldSession.outputHtml || '') + banner + bootOutput).slice(-MAX_OUTPUT_LENGTH),
    isSudo: Boolean(res.isSudo),
    infoBoxOutputs: {}
  };
  if (state.sessionHistories[oldKey]) sessionHistories[newKey] = state.sessionHistories[oldKey];
  if (broadcastInputSessions.delete(oldKey)) broadcastInputSessions.add(newKey);
  if (term) {
    xtermInstances[newKey] = term;
    term.__termixSessionKey = newKey;
    term.write(banner + bootOutput);
    // 新 PTY 不會繼承舊連線尺寸，即使 xterm 的尺寸沒變也必須同步。
    TerminalAPI.resizeTerminal(newKey, term.cols, term.rows).catch(() => {});
  }

  reconnectContexts.delete(oldKey);
  reconnectingKeys.delete(oldKey);
  const migratedCtx = { ...ctx, key: newKey, status: 'success', inFlight: false };
  if (migratedCtx.pendingInput) reconnectContexts.set(newKey, migratedCtx);

  // 一次發布完整遷移，避免重繪在 pane、session 與 xterm 綁定不同步時建立空白終端。
  terminalStore.setState({
    sessions, xtermInstances, sessionHistories, broadcastInputSessions,
    workspaces: state.workspaces.map(ws => ({
      ...ws,
      columns: ws.columns.map(col => ({
        ...col,
        panes: col.panes.map(pane => pane.sessionKey === oldKey ? { ...pane, sessionKey: newKey } : pane)
      }))
    })),
    activePaneSessionKey: state.activePaneSessionKey === oldKey ? newKey : state.activePaneSessionKey
  });

  notify(migratedCtx, 'success', { oldKey, newKey });
}

/**
 * 送出暫存輸入（使用者按下「送出」）。
 * @param {string} sessionKey 目前 pane 綁定的（重連後）sessionKey
 * @returns {boolean}
 */
export function flushPendingInput(sessionKey) {
  const ctx = reconnectContexts.get(sessionKey);
  if (!ctx || !ctx.pendingInput) return false;
  const data = ctx.pendingInput;
  ctx.pendingInput = '';
  TerminalAPI.writeTerminalInput(sessionKey, data).catch(() => {});
  reconnectContexts.delete(sessionKey);
  return true;
}

/**
 * 捨棄暫存輸入（使用者按下「捨棄」）。
 * @param {string} sessionKey
 * @returns {boolean}
 */
export function discardPendingInput(sessionKey) {
  const ctx = reconnectContexts.get(sessionKey);
  if (!ctx) return false;
  ctx.pendingInput = '';
  reconnectContexts.delete(sessionKey);
  return true;
}

function notify(ctx, status, extra) {
  ctx.status = status;
  const hook = ctx.hooks && ctx.hooks.onStatus;
  if (typeof hook === 'function') {
    try {
      hook(ctx.key, status, { ctx, ...(extra || {}) });
    } catch (e) {
      /* UI 回呼錯誤不影響重連狀態機 */
    }
  }
}

// 導出給測試用途：讀取內部旗標數量。
export function _debugState() {
  return {
    reconnectingCount: reconnectingKeys.size,
    contextCount: reconnectContexts.size
  };
}

// 為避免 lint 抱怨未使用（consumeUserClosed 由 App.js 呼叫），保留 re-export 以維持相依關係清楚。
export { consumeUserClosed };
