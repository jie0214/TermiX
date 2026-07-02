import { terminalStore } from './TerminalStore';
import { TerminalAPI } from './TerminalAPI';
import { cleanupFrontendSession, markSessionUserClosed } from './TerminalLifecycle';
import {
  isReconnecting,
  getReconnectContext,
  bufferReconnectInput,
  retryReconnect,
  abortReconnect,
  flushPendingInput,
  discardPendingInput
} from './TerminalReconnect';
import { confirmDialog } from '../../components/feedback/confirmDialog';
import { themeStore } from '../../stores/ThemeStore';
import { Terminal } from '@xterm/xterm';
import { t } from '../../i18n/index.ts';

/**
 * 從 CSS 自訂屬性讀取目前主題的終端機配色，生成 xterm.js theme 物件。
 * 透過 getComputedStyle 讀取實際計算值，確保與 CSS 變數完全同步。
 */
function getXtermTheme() {
  const style = getComputedStyle(document.documentElement);
  const get = (v) => style.getPropertyValue(v).trim();
  return {
    background:    get('--terminal-bg')      || '#0b0f19',
    foreground:    get('--terminal-foreground') || '#d7e0e5',
    cursor:        get('--terminal-accent')   || '#7fb5c8',
    cursorAccent:  get('--terminal-bg')      || '#0b0f19',
    selectionBackground: 'rgba(127, 181, 200, 0.28)',
    black:         '#0b0f19',
    red:           '#f87171',
    green:         get('--terminal-accent')  || '#6ee7b7',
    yellow:        '#fbbf24',
    blue:          get('--color-primary')    || '#7fb5c8',
    magenta:       '#c084fc',
    cyan:          get('--terminal-accent')  || '#7fb5c8',
    white:         get('--terminal-foreground') || '#d7e0e5',
    brightBlack:   get('--terminal-muted')   || '#94a3b8',
    brightRed:     '#fca5a5',
    brightGreen:   '#86efac',
    brightYellow:  '#fde68a',
    brightBlue:    get('--color-primary-hover') || '#9cc8d8',
    brightMagenta: '#d8b4fe',
    brightCyan:    get('--terminal-accent')  || '#a5f3fc',
    brightWhite:   '#f8fafc',
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class TerminalPage extends HTMLElement {
  constructor() {
    super();
    this.unsubscribe = null;
    this.unsubscribeTheme = null;
    this.resizeObserver = null;
    // 追蹤所有以 setManagedTimeout 建立的計時器 id，卸載時統一清除，
    // 避免元件快速卸載/重繪後回呼仍操作已 dispose() 的 xterm 實例。
    this.pendingTimers = new Set();
    // 拖曳調整大小期間綁在 document 上的 listener，透過 AbortController 統一移除，
    // 確保拖曳進行中若元件被卸載也不會殘留 listener 與舊 closure 參照。
    this.dragAbortController = null;
  }

  /**
   * 包一層 setTimeout：保存 timer id 於 this.pendingTimers，回呼執行時先移除 id，
   * 使 disconnectedCallback 能一併 clearTimeout 尚未觸發的計時器。行為與原生 setTimeout 一致。
   */
  setManagedTimeout(fn, ms) {
    const id = setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
    return id;
  }

  connectedCallback() {
    this.lastFingerprint = '';
    this.lastActivePaneSessionKey = null;
    this.lastBroadcastSessions = new Set();

    // 第一次進行初始渲染與狀態快取
    const state = terminalStore.getState();
    this.lastFingerprint = this.getWorkspaceStructureFingerprint(state);
    this.lastActivePaneSessionKey = state.activePaneSessionKey;
    this.lastBroadcastSessions = new Set(state.broadcastInputSessions);

    this.render();
    this.initPanesXterm();
    this.setupListeners();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // 訂閱 Zustand 狀態，實施精準的比對更新機制
    this.unsubscribe = terminalStore.subscribe((state) => {
      // 1. 檢查結構特徵碼是否改變
      const currentFingerprint = this.getWorkspaceStructureFingerprint(state);
      if (currentFingerprint !== this.lastFingerprint) {
        this.lastFingerprint = currentFingerprint;
        this.lastActivePaneSessionKey = state.activePaneSessionKey;
        this.lastBroadcastSessions = new Set(state.broadcastInputSessions);

        this.render();
        this.initPanesXterm();
        this.setupListeners();
        return;
      }

      // 2. 若結構沒變，僅在 activePaneSessionKey 改變時進行局部 DOM 樣式更新
      if (state.activePaneSessionKey !== this.lastActivePaneSessionKey) {
        this.lastActivePaneSessionKey = state.activePaneSessionKey;
        this.updateActivePaneUI(state.activePaneSessionKey);

        // 當切換活動視窗時，自動讓該 xterm.js 實例獲取焦點
        const term = state.xtermInstances[state.activePaneSessionKey];
        if (term) {
          this.setManagedTimeout(() => {
            this.resizeXtermToContainer(state.activePaneSessionKey);
            term.focus();
          }, 0);
        }
      }

      // 3. 若結構沒變，僅在 broadcastInputSessions 改變時進行局部按鈕樣式更新
      const broadcastChanged = (
        state.broadcastInputSessions.size !== this.lastBroadcastSessions.size ||
        [...state.broadcastInputSessions].some(k => !this.lastBroadcastSessions.has(k))
      );
      if (broadcastChanged) {
        this.lastBroadcastSessions = new Set(state.broadcastInputSessions);
        this.updateBroadcastUI(state.broadcastInputSessions);
      }
    });

    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
      this.unsubscribeTheme = null;
    }
    this.unsubscribeTheme = themeStore.subscribe((state, prevState) => {
      if (prevState && state.terminalTextSize !== prevState.terminalTextSize) {
        this.applyTerminalTextSize(state.terminalTextSize);
      }
      // 主題變更時，即時更新所有已存在的 xterm 實例配色
      // 同時偵測 _systemTs 變化（system 主題跟隨系統配色切換時觸發）
      const themeChanged = !prevState || state.theme !== prevState.theme;
      const systemTsChanged = Boolean(prevState && state._systemTs !== prevState._systemTs);
      if (themeChanged || systemTsChanged) {
        // 等待 CSS 類別套用至 documentElement 後再讀取 computed style
        requestAnimationFrame(() => {
          this.applyXtermThemeToAll();
        });
      }
    });

    // 監聽視窗 resize，自動調整 xterm 尺寸
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeAllXterms();
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.unsubscribeTheme) this.unsubscribeTheme();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    // 清除所有尚未觸發的延遲回呼，避免操作已 dispose() 的 xterm 實例。
    this.pendingTimers.forEach((id) => clearTimeout(id));
    this.pendingTimers.clear();
    // 若拖曳調整大小進行中被卸載，移除綁在 document 上的 mousemove/mouseup listener。
    if (this.dragAbortController) {
      this.dragAbortController.abort();
      this.dragAbortController = null;
    }
  }

  getTerminalTextSize() {
    return themeStore.getState().terminalTextSize || 12.5;
  }

  /**
   * 對所有現有 xterm.js 實例套用當前主題配色。
   * 必須在 CSS 類別套用至 documentElement 後呼叫（通常在 requestAnimationFrame 內）。
   * 步驟：
   *   1. 讀取最新 CSS 計算值生成 theme 物件
   *   2. 設定 term.options.theme
   *   3. 呼叫 term.refresh() 強制 Canvas 重繪
   *   4. 手動更新 .xterm-viewport DOM 背景（xterm.js 不會自動刷新 DOM 的 backgroundColor）
   */
  applyXtermThemeToAll() {
    const xtermTheme = getXtermTheme();
    const instances = terminalStore.getState().xtermInstances;
    Object.values(instances).forEach((term) => {
      if (!term || !term.options) return;

      // 1. 更新 xterm.js 的 theme 選項
      term.options.theme = xtermTheme;

      // 2. 強制重繪 Canvas 文字層
      if (term.element && typeof term.refresh === 'function') {
        try {
          term.refresh(0, term.rows - 1);
        } catch (e) {
          // 若 term 尚未完全初始化則忽略
        }
      }

      // 3. 手動更新 xterm-viewport DOM 背景色
      //    xterm.js 在 open() 時直接寫入 element.style，後續 theme 更新不會再寫
      if (term.element) {
        const viewport = term.element.querySelector('.xterm-viewport');
        if (viewport) {
          viewport.style.backgroundColor = xtermTheme.background;
        }
        const screen = term.element.querySelector('.xterm-screen');
        if (screen) {
          screen.style.backgroundColor = xtermTheme.background;
        }
      }
    });
  }

  // 計算當前分頁的結構特徵碼，以此判斷是否需要重新渲染整個 DOM 結構
  getWorkspaceStructureFingerprint(state) {
    const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (!ws) return 'none';

    // 結構特徵碼字串包含：工作空間 ID + Columns 寬度與其內 Pane Sessions 與高度的映射關係
    const colsFingerprint = ws.columns.map(col => {
      const panesFingerprint = col.panes.map(pane => `${pane.sessionKey}:${pane.height}`).join(',');
      return `col:${col.width}[${panesFingerprint}]`;
    }).join('|');

    return `${state.activeWorkspaceId}#${colsFingerprint}`;
  }

  // 局部更新活動視窗 (Active Pane) 的 UI Class 與樣式，避免毀滅重建 DOM
  updateActivePaneUI(activePaneSessionKey) {
    const state = terminalStore.getState();
    const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);

    // 1. 更新批次執行側邊欄 targets 列表狀態
    if (ws && ws.isSnippetBatch) {
      this.querySelectorAll('.batch-target-item').forEach((itemEl) => {
        const sessionKey = itemEl.getAttribute('data-session-key');
        const isActive = sessionKey === activePaneSessionKey;
        if (isActive) {
          itemEl.classList.add('active');
          itemEl.style.color = 'var(--color-primary)';
          itemEl.style.background = 'color-mix(in srgb, var(--color-primary) 15%, transparent)';
          itemEl.style.borderLeftColor = 'var(--color-primary)';
          const labelEl = itemEl.querySelector('span:not(.pane-status-dot)');
          if (labelEl) labelEl.style.fontWeight = '700';
        } else {
          itemEl.classList.remove('active');
          itemEl.style.color = 'var(--color-subtext)';
          itemEl.style.background = 'transparent';
          itemEl.style.borderLeftColor = 'transparent';
          const labelEl = itemEl.querySelector('span:not(.pane-status-dot)');
          if (labelEl) labelEl.style.fontWeight = 'normal';
        }
      });
    }

    // 2. 更新 columns 顯示狀態
    this.querySelectorAll('.terminal-column').forEach((colEl) => {
      const colIdx = parseInt(colEl.getAttribute('data-col-idx'), 10);
      const col = ws?.columns?.[colIdx];
      if (!col) return;
      if (ws && ws.isSnippetBatch) {
        const isColActive = col.panes.some(p => p.sessionKey === activePaneSessionKey);
        if (isColActive) {
          colEl.style.setProperty('display', 'flex', 'important');
          colEl.style.width = '100%';
          colEl.style.flex = '1 1 100%';
        } else {
          colEl.style.setProperty('display', 'none', 'important');
        }
      } else {
        colEl.style.removeProperty('display');
        colEl.style.width = `${col.width}%`;
        colEl.style.flex = `0 0 ${col.width}%`;
      }
    });

    // 3. 更新 pane 自己的 active class 與 title 顏色
    this.querySelectorAll('.terminal-pane').forEach((paneEl) => {
      const sessionKey = paneEl.getAttribute('data-session-key');
      const isPaneActive = sessionKey === activePaneSessionKey;

      if (isPaneActive) {
        paneEl.classList.add('active');
      } else {
        paneEl.classList.remove('active');
      }

      const titleEl = paneEl.querySelector('.pane-title');
      if (titleEl) {
        titleEl.style.color = isPaneActive ? 'var(--color-primary)' : 'var(--color-text-muted)';
      }
    });
  }

  // 局部更新廣播按鈕 (Broadcast Toggle) 的 UI 狀態，避免毀滅重建 DOM
  updateBroadcastUI(broadcastInputSessions) {
    this.querySelectorAll('.pane-broadcast-toggle').forEach((btn) => {
      const sessionKey = btn.getAttribute('data-session-key');
      const isBroadcasting = broadcastInputSessions.has(sessionKey);

      if (isBroadcasting) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  // ------------------------------------------------------------------------
  // L3：斷線重連 Overlay
  // ------------------------------------------------------------------------
  // Overlay 於初次 render 時就內建於每個 pane（預設隱藏），實際顯示 / 內容由
  // updateReconnectOverlay 依 reconnect 狀態機的 onStatus 回呼與 render 時的
  // 重連狀態即時控制，避免破壞既有 fingerprint guard 與 pane DOM 結構。
  // ------------------------------------------------------------------------

  /**
   * 產生某 pane 的重連 overlay HTML。若該 sessionKey 目前無重連狀態，回傳隱藏的骨架。
   * @param {string} sessionKey
   * @returns {string}
   */
  renderReconnectOverlay(sessionKey) {
    const reconnecting = isReconnecting(sessionKey);
    const ctx = getReconnectContext(sessionKey);
    // 決定初始顯示狀態：重連中 → connecting；有 pendingInput（重連成功待確認）→ pending。
    let initialState = 'hidden';
    if (reconnecting) initialState = 'connecting';
    else if (ctx && ctx.pendingInput) initialState = 'pending';

    return `
      <div class="pane-reconnect-overlay" data-session-key="${sessionKey}" data-reconnect-state="${initialState}"
           style="position: absolute; inset: 0; z-index: 90; display: ${initialState === 'hidden' ? 'none' : 'flex'}; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: rgba(7, 10, 16, 0.82); backdrop-filter: blur(1.5px); border-radius: 6px; box-sizing: border-box; padding: 16px; text-align: center;">
        <div class="reconnect-overlay-msg" style="font-size: 13.5px; font-weight: 700; color: #d7e0e5; line-height: 1.5; max-width: 90%;"></div>
        <div class="reconnect-overlay-actions" style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;"></div>
      </div>
    `;
  }

  /**
   * 更新指定 pane 的重連 overlay 顯示狀態與按鈕。由 reconnect onStatus 回呼與
   * setupListeners 於重繪後呼叫。狀態：connecting / failed / pending / hidden。
   * @param {string} sessionKey
   * @param {'connecting'|'failed'|'pending'|'hidden'} [statusOverride]
   */
  updateReconnectOverlay(sessionKey, statusOverride) {
    const overlay = this.querySelector(`.pane-reconnect-overlay[data-session-key="${CSS.escape(sessionKey)}"]`);
    if (!overlay) return;

    const reconnecting = isReconnecting(sessionKey);
    const ctx = getReconnectContext(sessionKey);

    // 推導狀態：優先採用外部指定（onStatus），否則依當前重連旗標 / pendingInput 推導。
    let uiState = statusOverride;
    if (!uiState) {
      if (reconnecting) uiState = 'connecting';
      else if (ctx && ctx.pendingInput) uiState = 'pending';
      else uiState = 'hidden';
    }
    // onStatus 傳入 'success' 時，實際 UI 應視 pendingInput 決定 pending / hidden。
    if (uiState === 'success') {
      uiState = ctx && ctx.pendingInput ? 'pending' : 'hidden';
    }

    const msgEl = overlay.querySelector('.reconnect-overlay-msg');
    const actionsEl = overlay.querySelector('.reconnect-overlay-actions');
    if (!msgEl || !actionsEl) return;

    const label = (ctx && ctx.label) || sessionKey;
    const btnBase = 'cursor: pointer; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--color-border); background: transparent; color: var(--color-subtext); transition: all 0.2s;';
    const btnPrimary = 'cursor: pointer; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--color-primary); background: color-mix(in srgb, var(--color-primary) 18%, transparent); color: var(--color-primary); transition: all 0.2s;';

    overlay.setAttribute('data-reconnect-state', uiState);

    if (uiState === 'hidden') {
      overlay.style.display = 'none';
      msgEl.textContent = '';
      actionsEl.innerHTML = '';
      return;
    }

    overlay.style.display = 'flex';

    if (uiState === 'connecting') {
      msgEl.textContent = t('terminal.reconnectConnecting', { name: label });
      actionsEl.innerHTML = `
        <button type="button" class="no-drag reconnect-btn-abort" data-session-key="${sessionKey}" style="${btnBase}">${t('common.close')}</button>
      `;
    } else if (uiState === 'failed') {
      msgEl.textContent = t('terminal.reconnectFailed', { name: label });
      actionsEl.innerHTML = `
        <button type="button" class="no-drag reconnect-btn-retry" data-session-key="${sessionKey}" style="${btnPrimary}">${t('terminal.reconnectRetry')}</button>
        <button type="button" class="no-drag reconnect-btn-abort" data-session-key="${sessionKey}" style="${btnBase}">${t('common.close')}</button>
      `;
    } else if (uiState === 'pending') {
      msgEl.textContent = t('terminal.reconnectPending');
      actionsEl.innerHTML = `
        <button type="button" class="no-drag reconnect-btn-flush" data-session-key="${sessionKey}" style="${btnPrimary}">${t('terminal.reconnectFlush')}</button>
        <button type="button" class="no-drag reconnect-btn-discard" data-session-key="${sessionKey}" style="${btnBase}">${t('terminal.reconnectDiscard')}</button>
      `;
    }

    this.wireReconnectOverlayButtons(overlay);
  }

  /**
   * 綁定 overlay 內按鈕的點擊行為（每次 innerHTML 重建後呼叫）。
   * @param {Element} overlay
   */
  wireReconnectOverlayButtons(overlay) {
    const retryBtn = overlay.querySelector('.reconnect-btn-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = retryBtn.getAttribute('data-session-key');
        this.updateReconnectOverlay(key, 'connecting');
        retryReconnect(key);
      });
    }
    const abortBtn = overlay.querySelector('.reconnect-btn-abort');
    if (abortBtn) {
      abortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = abortBtn.getAttribute('data-session-key');
        // 放棄重連 → 清理重連上下文後，走既有 closePane 流程移除 pane。
        abortReconnect(key);
        this.updateReconnectOverlay(key, 'hidden');
        this.closePane(key);
      });
    }
    const flushBtn = overlay.querySelector('.reconnect-btn-flush');
    if (flushBtn) {
      flushBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = flushBtn.getAttribute('data-session-key');
        flushPendingInput(key);
        this.updateReconnectOverlay(key, 'hidden');
        const term = terminalStore.getState().xtermInstances[key];
        if (term) this.setManagedTimeout(() => term.focus(), 0);
      });
    }
    const discardBtn = overlay.querySelector('.reconnect-btn-discard');
    if (discardBtn) {
      discardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = discardBtn.getAttribute('data-session-key');
        discardPendingInput(key);
        this.updateReconnectOverlay(key, 'hidden');
        const term = terminalStore.getState().xtermInstances[key];
        if (term) this.setManagedTimeout(() => term.focus(), 0);
      });
    }
  }

  /**
   * 重繪後同步所有 pane 的重連 overlay（依當前重連狀態機的狀態）。
   */
  syncAllReconnectOverlays() {
    this.querySelectorAll('.pane-reconnect-overlay').forEach((overlay) => {
      const key = overlay.getAttribute('data-session-key');
      if (key) this.updateReconnectOverlay(key);
    });
  }

  render() {
    const state = terminalStore.getState();
    const activeWorkspaceId = state.activeWorkspaceId;
    const ws = state.workspaces.find(w => w.id === activeWorkspaceId);
    const terminalTextSize = this.getTerminalTextSize();

    if (!ws) {
      this.innerHTML = `
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-muted); font-size: 14px;">
          ${t('terminal.emptyHint')}
        </div>
      `;
      return;
    }

    let sidebarHtml = "";
    if (ws.isSnippetBatch) {
      let targetsHtml = "";
      ws.columns.forEach((col) => {
        col.panes.forEach((pane) => {
          const session = state.sessions[pane.sessionKey];
          if (!session) return;
          const isActive = pane.sessionKey === state.activePaneSessionKey;
          targetsHtml += `
            <div class="no-drag batch-target-item ${isActive ? 'active' : ''}" data-session-key="${pane.sessionKey}" style="padding: 10px 12px; margin: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px; transition: all 0.2s; display: flex; align-items: center; gap: 8px; color: ${isActive ? 'var(--color-primary)' : 'var(--color-subtext)'}; background: ${isActive ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'transparent'}; border-left: 3px solid ${isActive ? 'var(--color-primary)' : 'transparent'};">
              <span class="pane-status-dot" style="width: 6px; height: 6px; border-radius: 50%; background: ${session.isSudo ? '#ef4444' : '#2ecc71'}; flex-shrink: 0;"></span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: ${isActive ? '700' : 'normal'};">${session.label}</span>
            </div>
          `;
        });
      });

      sidebarHtml = `
        <style>
          .batch-target-item:hover {
            background: color-mix(in srgb, var(--color-text-muted) 10%, transparent) !important;
            color: var(--color-text) !important;
          }
          .batch-target-item.active:hover {
            background: color-mix(in srgb, var(--color-primary) 20%, transparent) !important;
            color: var(--color-primary) !important;
          }
        </style>
        <div class="snippet-batch-sidebar" style="width: 180px; flex: 0 0 180px; border-right: 1px solid rgba(36, 54, 65, 0.5); background: #070a10; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding-top: 8px;">
          <div style="padding: 8px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted);">${t('terminal.batchTargets')}</div>
          <div class="batch-targets-list" style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0;">
            ${targetsHtml}
          </div>
        </div>
      `;
    }

    let panesHtml = "";
    ws.columns.forEach((col, colIdx) => {
      let colPanesHtml = "";
      col.panes.forEach((pane, paneIdx) => {
        const session = state.sessions[pane.sessionKey];
        if (!session) return;
        const isPaneActive = pane.sessionKey === state.activePaneSessionKey;
        const isBroadcasting = state.broadcastInputSessions.has(pane.sessionKey);

        colPanesHtml += `
          <div class="no-drag terminal-pane ${isPaneActive ? 'active' : ''}" data-session-key="${pane.sessionKey}" data-col-idx="${colIdx}" data-pane-idx="${paneIdx}" style="height: ${pane.height}%; flex: 0 0 ${pane.height}%; display: flex; flex-direction: column; width: 100%; min-width: 0; padding: 10px; box-sizing: border-box; position: relative;">
            <div class="pane-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; border-bottom: 1px solid rgba(36, 54, 65, 0.5); margin-bottom: 8px; flex: 0 0 auto;">
              <span class="pane-title" style="font-size: 11.5px; font-weight: 700; color: ${isPaneActive ? 'var(--color-primary)' : 'var(--color-text-muted)'};">${session.label} ~</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="pane-status-dot" style="width: 6px; height: 6px; border-radius: 50%; background: ${session.isSudo ? '#ef4444' : '#2ecc71'};"></span>
                <button type="button" aria-label="${t('terminal.broadcastInput')}" class="no-drag pane-broadcast-toggle ${isBroadcasting ? 'active' : ''} ${session.isLogView ? 'hidden' : ''}" data-session-key="${pane.sessionKey}" title="${t('terminal.broadcastInput')}" aria-pressed="${isBroadcasting ? 'true' : 'false'}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 7v10"/><path d="M20 10v4"/>
                  </svg>
                </button>
                <button type="button" class="no-drag close-pane" data-session-key="${pane.sessionKey}" style="cursor: pointer; font-size: 14px; font-weight: bold; color: var(--color-subtext); line-height: 1; padding: 2px 4px; background: transparent; border: none; transition: color 0.2s;" title="${t('terminal.closePane')}" aria-label="${t('terminal.closePane')}">&times;</button>
              </div>
            </div>
            
            <div class="no-drag xterm-pane-container ${session.isLogView ? 'hidden' : ''}" data-session-key="${pane.sessionKey}" style="flex: 1; min-height: 0; width: 100%; text-align: left;"></div>
            
            <pre class="pane-output traditional-ui-pane ${session.isLogView ? '' : 'hidden'}" data-session-key="${pane.sessionKey}" style="flex: 1; overflow-y: auto; margin: 0; padding: 0 0 10px 0; color: #d7e0e5; background: transparent; border: none; line-height: 1.6; white-space: pre-wrap; font-family: monospace; font-size: ${terminalTextSize}px; text-align: left;">${escapeHtml(session.outputHtml || "")}</pre>
            <div class="pane-input-line traditional-ui-pane hidden" style="${session.isLogView ? 'display: none !important;' : 'display: flex;'} align-items: center; gap: 8px; border-top: 1px solid rgba(36, 54, 65, 0.5); padding-top: 6px; margin-top: 6px; flex: 0 0 auto;">
              <span class="pane-prompt ${session.isSudo ? 'sudo' : 'user'}" data-session-key="${pane.sessionKey}" style="font-weight: 700; font-family: monospace; font-size: ${terminalTextSize}px; color: ${session.isSudo ? '#ef4444' : '#73d391'};">${session.isSudo ? '#' : '$'}</span>
              <input class="no-drag pane-input" data-session-key="${pane.sessionKey}" autocomplete="off" spellcheck="false" placeholder="${t('terminal.inputPlaceholder')}" style="flex: 1; border: none !important; outline: none !important; background: transparent !important; color: var(--terminal-foreground) !important; padding: 0 !important; font-family: monospace; font-size: ${terminalTextSize}px; min-height: auto;" value="">
            </div>

            <!-- 四向拖放高亮 Overlay -->
            <div class="pane-drag-overlay" style="position: absolute; inset: 0; background: rgba(23, 107, 135, 0.25); pointer-events: none; opacity: 0; transition: all 0.15s ease-in-out; border: 2px dashed var(--color-primary); z-index: 100; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.85); box-sizing: border-box;"></div>

            <!-- L3 斷線重連 Overlay（預設隱藏，由 reconnect 狀態機透過 updateReconnectOverlay 控制顯示） -->
            ${this.renderReconnectOverlay(pane.sessionKey)}
          </div>
        `;

        if (paneIdx < col.panes.length - 1) {
          colPanesHtml += `
            <div class="pane-divider-vertical" data-col-idx="${colIdx}" data-top-idx="${paneIdx}" style="height: 4px; flex: 0 0 4px; width: 100%; background: rgba(36, 54, 65, 0.5); cursor: row-resize; position: relative; z-index: 10; transition: background 0.2s;"></div>
          `;
        }
      });

      let colStyle = "";
      if (ws.isSnippetBatch) {
        const isColActive = col.panes.some(p => p.sessionKey === state.activePaneSessionKey);
        colStyle = isColActive
          ? `width: 100%; flex: 1 1 100%; display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative;`
          : `display: none !important; width: 100%; flex: 1 1 100%; flex-direction: column; height: 100%; min-height: 0; position: relative;`;
      } else {
        colStyle = `width: ${col.width}%; flex: 0 0 ${col.width}%; display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative;`;
      }

      panesHtml += `
        <div class="terminal-column" data-col-idx="${colIdx}" style="${colStyle}">
          ${colPanesHtml}
        </div>
      `;

      if (!ws.isSnippetBatch && colIdx < ws.columns.length - 1) {
        panesHtml += `
          <div class="column-divider" data-left-idx="${colIdx}" style="width: 4px; background: rgba(36, 54, 65, 0.5); cursor: col-resize; position: relative; z-index: 10; height: 100%; transition: background 0.2s;"></div>
        `;
      }
    });

    this.innerHTML = `
      <div class="terminal-container" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0;">
        <div id="panesContainer" class="panes-container" style="flex: 1; display: flex; min-height: 0; overflow: hidden; background: var(--terminal-bg); border: 0; border-radius: 8px; padding: 0; gap: 0; position: relative;">
          ${sidebarHtml}
          ${panesHtml}
        </div>
      </div>
    `;
  }

  initPanesXterm() {
    const state = terminalStore.getState();
    const activeWorkspaceId = state.activeWorkspaceId;
    const ws = state.workspaces.find(w => w.id === activeWorkspaceId);
    if (!ws) return;

    this.querySelectorAll('.xterm-pane-container').forEach((container) => {
      const sessionKey = container.getAttribute('data-session-key');
      if (!sessionKey) return;

      let term = terminalStore.getState().xtermInstances[sessionKey];
      const session = terminalStore.getState().sessions[sessionKey];
      if (session?.isLogView) return;

      if (!term) {
        term = new Terminal({
          cursorBlink: true,
          fontSize: this.getTerminalTextSize(),
          fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace',
          theme: getXtermTheme()
        });
        terminalStore.getState().setXtermInstance(sessionKey, term);
        // 在 term 實例上掛可變屬性，記錄「當前」綁定的 sessionKey。
        // 首次建立時等於此 pane 的 sessionKey；重連遷移 / 分割視窗重用（re-parent）時會同步更新。
        // onData 內一律讀此屬性而非閉包常數，確保重連換綁後輸入仍送到正確 session。
        term.__termixSessionKey = sessionKey;

        term.onData((data) => {
          const activeKey = term.__termixSessionKey;
          // L3：若此 session 正處於重連流程，輸入先暫存而不送出，
          // 重連成功後由 overlay 讓使用者確認送出 / 捨棄，避免半截指令誤送到新 shell。
          if (isReconnecting(activeKey)) {
            bufferReconnectInput(activeKey, data);
            return;
          }
          TerminalAPI.writeTerminalInput(activeKey, data).catch(() => {});

          // 廣播輸入邏輯
          const innerState = terminalStore.getState();
          if (innerState.broadcastInputSessions.has(activeKey)) {
            const currWs = innerState.workspaces.find(w => w.id === innerState.activeWorkspaceId);
            if (currWs) {
              currWs.columns.forEach((col) => {
                col.panes.forEach((pane) => {
                  if (pane.sessionKey !== activeKey) {
                    TerminalAPI.writeTerminalInput(pane.sessionKey, data).catch(() => {});
                  }
                });
              });
            }
          }
        });
      }

      // 每次進入此 pane 的處理流程都同步「當前綁定 key」：
      // - 首次建立：與上面設定一致（no-op）。
      // - 分割視窗重用：sessionKey 不變，維持原值。
      // - 重連遷移：store 中此實例已改綁新 key，container 的 data-session-key 亦為新 key，
      //   此處把 term.__termixSessionKey 同步為新 key，onData 即送到新 session。
      term.__termixSessionKey = sessionKey;

      // 若 xterm 已正確掛載在此容器中，跳過 DOM 操作，保護焦點與游標
      if (term.element && container.contains(term.element)) {
        this.setManagedTimeout(() => this.resizeXtermToContainer(sessionKey), 0);
        return;
      }

      // 若 xterm 實例已經開啟過（有 term.element），但目前不在新的容器中（例如分割視窗重繪），
      // 我們可以直接將現有的 term.element 移動到新容器中，免去重新呼叫 term.open(container) 以防內部事件監聽器死鎖與畫面崩潰
      if (term.element) {
        container.replaceChildren(term.element);
        this.applyTextareaDefense(container);
        this.setManagedTimeout(() => {
          this.resizeXtermToContainer(sessionKey);
          const currentState = terminalStore.getState();
          if (currentState.activePaneSessionKey === sessionKey) {
            this.setManagedTimeout(() => term.focus(), 0);
          }
        }, 50);
        return;
      }

      // 首次掛載：清空容器後掛載 xterm
      container.replaceChildren();
      term.open(container);
      this.applyTextareaDefense(container);
      this.setManagedTimeout(() => {
        this.resizeXtermToContainer(sessionKey);
        // 對活動視窗自動聚焦，確保首次開啟即可輸入
        const currentState = terminalStore.getState();
        if (currentState.activePaneSessionKey === sessionKey) {
          this.setManagedTimeout(() => term.focus(), 0);
        }
      }, 50);
    });
  }

  applyTextareaDefense(container) {
    this.setManagedTimeout(() => {
      const textarea = container.querySelector('.xterm-helper-textarea');
      if (textarea) {
        textarea.setAttribute('spellcheck', 'false');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('autocomplete', 'off');
      }
    }, 50);
  }

  resizeXtermToContainer(sessionKey) {
    const state = terminalStore.getState();
    const term = state.xtermInstances[sessionKey];
    const container = this.querySelector(`.xterm-pane-container[data-session-key="${sessionKey}"]`);
    if (!term || !container || !container.isConnected) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dimensions = term._core && term._core._renderService && term._core._renderService.dimensions;
    const cellWidth = dimensions && dimensions.css && dimensions.css.cell && dimensions.css.cell.width ? dimensions.css.cell.width : 7.5;
    const cellHeight = dimensions && dimensions.css && dimensions.css.cell && dimensions.css.cell.height ? dimensions.css.cell.height : 17;
    const cols = Math.max(20, Math.floor(rect.width / cellWidth));
    const rows = Math.max(5, Math.floor(rect.height / cellHeight));
    
    if (term.cols !== cols || term.rows !== rows) {
      term.resize(cols, rows);
      TerminalAPI.resizeTerminal(sessionKey, cols, rows).catch(() => {});
    }
  }

  resizeAllXterms() {
    const state = terminalStore.getState();
    Object.keys(state.xtermInstances).forEach((sessionKey) => {
      this.resizeXtermToContainer(sessionKey);
    });
  }

  applyTerminalTextSize(fontSize) {
    const state = terminalStore.getState();
    Object.keys(state.xtermInstances).forEach((sessionKey) => {
      const term = state.xtermInstances[sessionKey];
      if (term) {
        term.options.fontSize = fontSize;
      }
      this.resizeXtermToContainer(sessionKey);
    });
    this.querySelectorAll('.pane-output, .pane-prompt, .pane-input').forEach((el) => {
      el.style.fontSize = `${fontSize}px`;
    });
  }

  setupListeners() {
    const state = terminalStore.getState();
    const activeWorkspaceId = state.activeWorkspaceId;
    const ws = state.workspaces.find(w => w.id === activeWorkspaceId);
    if (!ws) return;

    // 1. Pane 點擊選取（僅更新 Store 中的活動視窗標記，不主動呼叫 term.focus）
    //    xterm.js 內部會自行處理 mousedown → focus textarea 的完整流程，
    //    在此期間從外部呼叫 term.focus() 會導致焦點處理迴圈與凍結。
    this.querySelectorAll('.terminal-pane').forEach((paneEl) => {
      const sessionKey = paneEl.getAttribute('data-session-key');

      paneEl.addEventListener('pointerdown', (e) => {
        const freshState = terminalStore.getState();
        if (freshState.activePaneSessionKey !== sessionKey) {
          freshState.setActivePaneSessionKey(sessionKey);
        }
      });
    });

    // 2. 廣播按鈕點擊
    this.querySelectorAll('.pane-broadcast-toggle').forEach((btn) => {
      const sessionKey = btn.getAttribute('data-session-key');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const innerState = terminalStore.getState();
        if (innerState.broadcastInputSessions.has(sessionKey)) {
          terminalStore.getState().removeBroadcastSession(sessionKey);
        } else {
          terminalStore.getState().addBroadcastSession(sessionKey);
        }
      });
    });

    // 3. 關閉 Pane
    this.querySelectorAll('.close-pane').forEach((btn) => {
      const sessionKey = btn.getAttribute('data-session-key');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePane(sessionKey);
      });
    });

    // 3.5 同步重連 overlay 顯示狀態並綁定其按鈕（每次重繪後）。
    this.syncAllReconnectOverlays();

    // 4. 橫向 Column 拖拉調整寬度比例
    this.querySelectorAll('.column-divider').forEach((divider) => {
      divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const leftIdx = parseInt(divider.getAttribute('data-left-idx'), 10);
        const rightIdx = leftIdx + 1;
        const leftCol = ws.columns[leftIdx];
        const rightCol = ws.columns[rightIdx];
        const initialX = e.clientX;
        const initialLeftWidth = leftCol.width;
        const initialRightWidth = rightCol.width;
        const containerWidth = this.querySelector('#panesContainer').clientWidth;
        
        const onMouseMove = (moveEvent) => {
          const deltaX = moveEvent.clientX - initialX;
          const deltaPercent = (deltaX / containerWidth) * 100;
          
          let newLeftWidth = initialLeftWidth + deltaPercent;
          let newRightWidth = initialRightWidth - deltaPercent;
          
          if (newLeftWidth >= 10 && newRightWidth >= 10) {
            leftCol.width = newLeftWidth;
            rightCol.width = newRightWidth;
            
            const leftColEl = this.querySelector(`.terminal-column[data-col-idx="${leftIdx}"]`);
            const rightColEl = this.querySelector(`.terminal-column[data-col-idx="${rightIdx}"]`);
            if (leftColEl && rightColEl) {
              leftColEl.style.width = `${newLeftWidth}%`;
              leftColEl.style.flex = `0 0 ${newLeftWidth}%`;
              rightColEl.style.width = `${newRightWidth}%`;
              rightColEl.style.flex = `0 0 ${newRightWidth}%`;
            }
          }
        };
        
        // 以 AbortController 統一管理本次拖曳的 document listener：
        // 正常結束（onMouseUp）與拖曳中被卸載（disconnectedCallback）皆呼叫 abort() 移除。
        if (this.dragAbortController) this.dragAbortController.abort();
        this.dragAbortController = new AbortController();
        const { signal } = this.dragAbortController;

        const onMouseUp = () => {
          this.dragAbortController?.abort();
          this.dragAbortController = null;
          this.resizeAllXterms();
        };

        document.addEventListener('mousemove', onMouseMove, { signal });
        document.addEventListener('mouseup', onMouseUp, { signal });
      });
    });

    // 5. 縱向 Pane 拖拉調整高度比例
    this.querySelectorAll('.pane-divider-vertical').forEach((divider) => {
      divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const colIdx = parseInt(divider.getAttribute('data-col-idx'), 10);
        const topIdx = parseInt(divider.getAttribute('data-top-idx'), 10);
        const bottomIdx = topIdx + 1;
        const col = ws.columns[colIdx];
        const topPane = col.panes[topIdx];
        const bottomPane = col.panes[bottomIdx];
        const initialY = e.clientY;
        const initialTopHeight = topPane.height;
        const initialBottomHeight = bottomPane.height;
        
        const colEl = this.querySelector(`.terminal-column[data-col-idx="${colIdx}"]`);
        const containerHeight = colEl.clientHeight;
        
        const onMouseMove = (moveEvent) => {
          const deltaY = moveEvent.clientY - initialY;
          const deltaPercent = (deltaY / containerHeight) * 100;
          
          let newTopHeight = initialTopHeight + deltaPercent;
          let newBottomHeight = initialBottomHeight - deltaPercent;
          
          if (newTopHeight >= 10 && newBottomHeight >= 10) {
            topPane.height = newTopHeight;
            bottomPane.height = newBottomHeight;
            
            const topPaneEl = colEl.querySelector(`.terminal-pane[data-pane-idx="${topIdx}"]`);
            const bottomPaneEl = colEl.querySelector(`.terminal-pane[data-pane-idx="${bottomIdx}"]`);
            if (topPaneEl && bottomPaneEl) {
              topPaneEl.style.height = `${newTopHeight}%`;
              topPaneEl.style.flex = `0 0 ${newTopHeight}%`;
              bottomPaneEl.style.height = `${newBottomHeight}%`;
              bottomPaneEl.style.flex = `0 0 ${newBottomHeight}%`;
            }
          }
        };
        
        // 以 AbortController 統一管理本次拖曳的 document listener：
        // 正常結束（onMouseUp）與拖曳中被卸載（disconnectedCallback）皆呼叫 abort() 移除。
        if (this.dragAbortController) this.dragAbortController.abort();
        this.dragAbortController = new AbortController();
        const { signal } = this.dragAbortController;

        const onMouseUp = () => {
          this.dragAbortController?.abort();
          this.dragAbortController = null;
          this.resizeAllXterms();
        };

        document.addEventListener('mousemove', onMouseMove, { signal });
        document.addEventListener('mouseup', onMouseUp, { signal });
      });
    });

    // 6. 窗格頂部 Pane Header 拖曳事件繫結
    this.querySelectorAll('.pane-header').forEach((header) => {
      const paneEl = header.closest('.terminal-pane');
      if (!paneEl) return;
      const sessionKey = paneEl.getAttribute('data-session-key');

      header.setAttribute('draggable', 'true');
      header.style.cursor = 'grab';

      header.addEventListener('dragstart', (e) => {
        header.style.cursor = 'grabbing';
        paneEl.classList.add('pane-dragging');
        // 傳遞 pane type 與 sessionKey
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'pane', sessionKey }));
        e.dataTransfer.effectAllowed = 'move';
      });

      header.addEventListener('dragend', () => {
        header.style.cursor = 'grab';
        paneEl.classList.remove('pane-dragging');
        // 清理所有遮罩的顯示
        this.querySelectorAll('.pane-drag-overlay').forEach(overlay => {
          overlay.style.opacity = '0';
        });
      });
    });

    // 7. 整個窗格 terminal-pane 的拖曳覆蓋、離開與放開事件繫結
    this.querySelectorAll('.terminal-pane').forEach((paneEl) => {
      const targetSessionKey = paneEl.getAttribute('data-session-key');
      const overlay = paneEl.querySelector('.pane-drag-overlay');

      paneEl.addEventListener('dragover', (e) => {
        e.preventDefault(); // 允許放開
        e.dataTransfer.dropEffect = 'move';

        const rect = paneEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;

        // 計算最靠近哪一個邊界比例 (0~1)
        const dists = {
          left: x / w,
          right: (w - x) / w,
          top: y / h,
          bottom: (h - y) / h
        };

        let direction = 'left';
        let minVal = dists.left;
        for (const key in dists) {
          if (dists[key] < minVal) {
            minVal = dists[key];
            direction = key;
          }
        }

        // 根據方向套用 clipPath 藍色半透明遮罩與文字導引
        if (overlay) {
          overlay.style.opacity = '1';
          if (direction === 'left') {
            overlay.style.clipPath = 'inset(0 50% 0 0)';
            overlay.textContent = t('terminal.mergeLeft');
          } else if (direction === 'right') {
            overlay.style.clipPath = 'inset(0 0 0 50%)';
            overlay.textContent = t('terminal.mergeRight');
          } else if (direction === 'top') {
            overlay.style.clipPath = 'inset(0 0 50% 0)';
            overlay.textContent = t('terminal.mergeTop');
          } else if (direction === 'bottom') {
            overlay.style.clipPath = 'inset(50% 0 0 0)';
            overlay.textContent = t('terminal.mergeBottom');
          }
          overlay.setAttribute('data-drag-direction', direction);
        }
      });

      paneEl.addEventListener('dragleave', () => {
        if (overlay) {
          overlay.style.opacity = '0';
        }
      });

      paneEl.addEventListener('drop', (e) => {
        e.preventDefault();
        if (overlay) {
          overlay.style.opacity = '0';
        }

        const direction = overlay ? overlay.getAttribute('data-drag-direction') : 'left';
        const rawData = e.dataTransfer.getData('text/plain');
        if (!rawData) return;

        try {
          if (rawData.startsWith('{')) {
            const dragData = JSON.parse(rawData);
            if (dragData.type === 'pane') {
              // 情況 A：窗格間拖曳排序
              if (dragData.sessionKey !== targetSessionKey) {
                this.handlePaneReorder(dragData.sessionKey, targetSessionKey, direction);
              }
              return;
            }
          }
        } catch (err) {
          // 不是 JSON 格式，則往下走情況 B
        }

        // 情況 B：來自頂部 Session Tab (Workspace ID) 的拖入合併
        const sourceWsId = rawData;
        const freshState = terminalStore.getState();
        const activeWorkspaceId = freshState.activeWorkspaceId;
        if (sourceWsId && sourceWsId !== activeWorkspaceId && sourceWsId !== 'host-tab') {
          this.handleWorkspacePaneMerge(sourceWsId, targetSessionKey, direction);
        }
      });
    });

    // 8. 批次目標 (Batch Targets) 側邊欄點擊事件
    if (ws.isSnippetBatch) {
      this.querySelectorAll('.batch-target-item').forEach((itemEl) => {
        const sessionKey = itemEl.getAttribute('data-session-key');
        itemEl.addEventListener('click', (e) => {
          const freshState = terminalStore.getState();
          if (freshState.activePaneSessionKey !== sessionKey) {
            freshState.setActivePaneSessionKey(sessionKey);
          }
        });
      });
    }
  }

  async closePane(sessionKey) {
    const state = terminalStore.getState();
    const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (!ws) return;

    // 破壞性操作二次確認：若此 pane 仍有連線中的 session（非本機終端、非歷史日誌回放），
    // 則關閉前先要求使用者確認；空 pane / 本機 / 日誌回放可直接關閉。
    const session = state.sessions[sessionKey];
    const isActiveSession = !!session && !session.isLogView && !session.isLocal && !(session.config && session.config.isLocal);
    if (isActiveSession) {
      const cfg = session.config || {};
      const sessionLabel = cfg.alias || session.label || cfg.host || sessionKey;
      if (!(await confirmDialog(t('terminal.closeConfirmMessage', { name: sessionLabel }), { title: t('terminal.closeConfirmTitle'), danger: true }))) {
        return;
      }
    }

    // 1. 斷開連線（標記為使用者主動關閉，避免觸發遠端斷線提示）
    markSessionUserClosed(sessionKey);
    TerminalAPI.closeTerminalSession(sessionKey).catch(() => {});

    // 2. 從 workspaces 結構中移除
    let foundColIdx = -1;
    let foundPaneIdx = -1;

    for (let cIdx = 0; cIdx < ws.columns.length; cIdx++) {
      const col = ws.columns[cIdx];
      const pIdx = col.panes.findIndex(p => p.sessionKey === sessionKey);
      if (pIdx !== -1) {
        foundColIdx = cIdx;
        foundPaneIdx = pIdx;
        break;
      }
    }

    if (foundColIdx !== -1 && foundPaneIdx !== -1) {
      const col = ws.columns[foundColIdx];
      col.panes.splice(foundPaneIdx, 1);

      if (col.panes.length === 0) {
        ws.columns.splice(foundColIdx, 1);
        if (ws.columns.length === 0) {
          // 移除該 Workspace
          terminalStore.getState().removeWorkspace(ws.id);
          const remain = terminalStore.getState().workspaces;
          if (remain.length > 0) {
            terminalStore.getState().setActiveWorkspaceId(remain[0].id);
            const firstPane = remain[0].columns[0]?.panes[0];
            terminalStore.getState().setActivePaneSessionKey(firstPane ? firstPane.sessionKey : null);
          } else {
            terminalStore.getState().setActiveWorkspaceId('host-tab');
            terminalStore.getState().setActivePaneSessionKey(null);
            // 路由退回到主機列表
            window.location.hash = '#/hosts';
          }
        } else {
          // 重新均分 columns
          const numCols = ws.columns.length;
          ws.columns.forEach(c => c.width = 100 / numCols);
        }
      } else {
        // 重新均分 panes
        const numPanes = col.panes.length;
        col.panes.forEach(p => p.height = 100 / numPanes);
      }

      if (terminalStore.getState().activePaneSessionKey === sessionKey) {
        const nextPane = col.panes[foundPaneIdx] || col.panes[foundPaneIdx - 1] || ws.columns[0]?.panes[0];
        terminalStore.getState().setActivePaneSessionKey(nextPane ? nextPane.sessionKey : null);
      }
    }

    // 3. 清理前端 session 資料
    cleanupFrontendSession(sessionKey);
    
    // 4. 觸發狀態重繪
    terminalStore.getState().setWorkspaces([...state.workspaces]);
  }

  // A. 分頁 Tab 拖曳分割合併至當前視窗
  handleWorkspacePaneMerge(sourceWsId, targetSessionKey, direction) {
    const state = terminalStore.getState();
    const workspaces = [...state.workspaces];
    const sourceWsIdx = workspaces.findIndex(w => w.id === sourceWsId);
    const targetWsIdx = workspaces.findIndex(w => w.id === state.activeWorkspaceId);

    if (sourceWsIdx === -1 || targetWsIdx === -1) return;

    const sourceWs = workspaces[sourceWsIdx];
    const targetWs = { ...workspaces[targetWsIdx] }; // 避免副作用

    // 收集來源 Workspace 裡的所有 sessionKeys
    const sessionKeysToMerge = [];
    sourceWs.columns.forEach(col => {
      col.panes.forEach(pane => {
        sessionKeysToMerge.push(pane.sessionKey);
      });
    });

    if (sessionKeysToMerge.length === 0) return;

    // 定位目標 targetSessionKey 所在的 column 與 pane
    let targetColIdx = -1;
    let targetPaneIdx = -1;

    for (let cIdx = 0; cIdx < targetWs.columns.length; cIdx++) {
      const col = targetWs.columns[cIdx];
      const pIdx = col.panes.findIndex(p => p.sessionKey === targetSessionKey);
      if (pIdx !== -1) {
        targetColIdx = cIdx;
        targetPaneIdx = pIdx;
        break;
      }
    }

    if (targetColIdx === -1) return;

    // 根據拖放方向進行分割插入
    if (direction === 'left' || direction === 'right') {
      // 橫向分割：建立全新獨立 column 插入 targetCol 的兩側
      const insertColIdx = direction === 'left' ? targetColIdx : targetColIdx + 1;
      const newCols = sessionKeysToMerge.map(sKey => ({
        id: 'col_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
        width: 100,
        panes: [{ sessionKey: sKey, height: 100 }]
      }));
      targetWs.columns.splice(insertColIdx, 0, ...newCols);
    } else {
      // 縱向分割：插入至 targetCol 的 panes 陣列中 targetPane 的上下側
      const insertPaneIdx = direction === 'top' ? targetPaneIdx : targetPaneIdx + 1;
      const newPanes = sessionKeysToMerge.map(sKey => ({
        sessionKey: sKey,
        height: 100
      }));
      targetWs.columns[targetColIdx].panes.splice(insertPaneIdx, 0, ...newPanes);
    }

    // 更新全局 workspaces
    workspaces[targetWsIdx] = targetWs;
    workspaces.splice(sourceWsIdx, 1); // 刪除已被合併的舊分頁

    // 重新均分布局並寫入 Zustand
    this.rebalanceWorkspaceLayout(targetWs, workspaces);
  }

  // B. 窗格間拖曳排序重新排列
  handlePaneReorder(sourceSessionKey, targetSessionKey, direction) {
    const state = terminalStore.getState();
    const workspaces = [...state.workspaces];
    const targetWsIdx = workspaces.findIndex(w => w.id === state.activeWorkspaceId);
    if (targetWsIdx === -1) return;

    const targetWs = { ...workspaces[targetWsIdx] };

    // 1. 定位並從當前結構中移出 sourceSessionKey
    let sourceColIdx = -1;
    let sourcePaneIdx = -1;

    for (let cIdx = 0; cIdx < targetWs.columns.length; cIdx++) {
      const col = targetWs.columns[cIdx];
      const pIdx = col.panes.findIndex(p => p.sessionKey === sourceSessionKey);
      if (pIdx !== -1) {
        sourceColIdx = cIdx;
        sourcePaneIdx = pIdx;
        break;
      }
    }

    if (sourceColIdx === -1) return;

    const sourcePaneObj = targetWs.columns[sourceColIdx].panes[sourcePaneIdx];
    targetWs.columns[sourceColIdx].panes.splice(sourcePaneIdx, 1);

    // 若原 column 空了，則將其刪除
    if (targetWs.columns[sourceColIdx].panes.length === 0) {
      targetWs.columns.splice(sourceColIdx, 1);
    }

    // 2. 重新在賸餘結構中尋找 targetSessionKey 的定位
    let targetColIdx = -1;
    let targetPaneIdx = -1;

    for (let cIdx = 0; cIdx < targetWs.columns.length; cIdx++) {
      const col = targetWs.columns[cIdx];
      const pIdx = col.panes.findIndex(p => p.sessionKey === targetSessionKey);
      if (pIdx !== -1) {
        targetColIdx = cIdx;
        targetPaneIdx = pIdx;
        break;
      }
    }

    if (targetColIdx === -1) return;

    // 3. 在目標位置插入
    if (direction === 'left' || direction === 'right') {
      const insertColIdx = direction === 'left' ? targetColIdx : targetColIdx + 1;
      const newCol = {
        id: 'col_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
        width: 100,
        panes: [{ sessionKey: sourceSessionKey, height: 100 }]
      };
      targetWs.columns.splice(insertColIdx, 0, newCol);
    } else {
      const insertPaneIdx = direction === 'top' ? targetPaneIdx : targetPaneIdx + 1;
      targetWs.columns[targetColIdx].panes.splice(insertPaneIdx, 0, {
        sessionKey: sourceSessionKey,
        height: 100
      });
    }

    // 更新全局 workspaces
    workspaces[targetWsIdx] = targetWs;

    // 重新均分布局並寫入 Zustand
    this.rebalanceWorkspaceLayout(targetWs, workspaces);
  }

  // C. 重新平衡並均分寬高度
  rebalanceWorkspaceLayout(ws, workspaces) {
    const numCols = ws.columns.length;
    ws.columns.forEach(col => {
      col.width = 100 / numCols;

      const numPanes = col.panes.length;
      col.panes.forEach(pane => {
        pane.height = 100 / numPanes;
      });
    });

    const firstPane = ws.columns[0]?.panes[0];
    const activePaneKey = firstPane ? firstPane.sessionKey : null;

    terminalStore.setState({
      workspaces: workspaces,
      activeWorkspaceId: ws.id,
      activePaneSessionKey: activePaneKey
    });
  }
}

customElements.define('terminal-page', TerminalPage);
