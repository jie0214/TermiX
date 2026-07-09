// 全域 Storage Quota 自我修復 Monkey Patch 防護機制 (相容 WebKit 唯讀屬性限制)
(function() {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    try {
      originalSetItem.call(this, key, value);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        console.warn('localStorage quota exceeded. Auto-recovering storage space...');

        if (key !== 'termix-session-logs') {
          throw e;
        }

        try {
          const logs = JSON.parse(value);
          if (!Array.isArray(logs)) throw e;
          const compactLogs = logs.slice(0, 15).map(log => ({
            ...log,
            outputHtml: log.outputHtml && log.outputHtml.length > 5000
              ? log.outputHtml.slice(log.outputHtml.length - 5000)
              : (log.outputHtml || '')
          }));
          originalSetItem.call(this, key, JSON.stringify(compactLogs));
        } catch (finalErr) {
          console.error('localStorage quota exceeded after log compaction:', finalErr);
          throw finalErr;
        }
      } else {
        throw e;
      }
    }
  };
})();

import { terminalStore } from './modules/terminal/TerminalStore';
import { TerminalAPI } from './modules/terminal/TerminalAPI';
import { cleanupFrontendSession, markSessionUserClosed, consumeUserClosed } from './modules/terminal/TerminalLifecycle';
import { isReconnectableSession, beginReconnect } from './modules/terminal/TerminalReconnect';
import { executeFunctionBox } from './modules/controlpanel/ControlPanelRuntime';
import { showToast } from './components/feedback/toast';
import { confirmDialog } from './components/feedback/confirmDialog';
import { getControlPanelDropPosition, getControlPanelThemeStyle, reorderControlPanelComponents } from './modules/controlpanel/ControlPanelLayout';
import { themeStore, UI_SCALE_OPTIONS } from './stores/ThemeStore';
import { t } from './i18n/index.ts';
import { matchShortcut, resolveShortcuts, detectPlatform, eventToBinding, bindingToTokens, SHORTCUT_ACTIONS, TAB_INDEX_ACTION_ID } from './domain/shortcuts.ts';
import { hostStore } from './modules/hostvault/HostStore';
import { HostAPI } from './modules/hostvault/HostAPI';
import { snippetStore } from './modules/snippets/SnippetStore';
import { pasteSnippetToSession, runSnippetInSession } from './modules/snippets/SnippetRuntime';
import { kubernetesSessionStore, KUBERNETES_SESSION_ID } from './modules/kubernetes/KubernetesSessionStore';
import { getAppBinding } from './platform/wails/bindings.ts';
import { onWailsEvent, getClipboardText, setClipboardText } from './platform/wails/events.ts';
import { mountLegacyRouter } from './routing/legacyRouter.js';
import './modules/hostvault/HostListPage';
import './modules/terminal/TerminalPage';
import './modules/controlpanel/ControlPanelPage';
import './modules/kubernetes/KubernetesSessionPage';

function stripAnsi(input) {
  return String(input || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 快捷鍵派發用：這些動作僅在終端聚焦時才攔截（其餘情境放行原生行為）。
const TERMINAL_ONLY_ACTIONS = new Set(['copy', 'paste', 'selectAll']);

// 快捷鍵鍵帽的行內樣式（沿用設定面板以行內樣式為主的慣例）。
const KEYCAP_STYLE = 'display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border:1px solid var(--color-border);border-radius:5px;background:var(--input-bg);color:var(--color-text);font-size:11px;font-weight:700;font-family:monospace;';

// 依平台預設，將某動作的覆寫寫入 map（等於預設則移除覆寫，讓其回退預設）。就地變動傳入的 map。
function setShortcutOverride(map, actionId, binding, platform) {
  const def = SHORTCUT_ACTIONS.find((a) => a.id === actionId)?.defaults[platform];
  if (binding === def) delete map[actionId];
  else map[actionId] = binding;
}

// 判斷焦點是否落在「非終端」的可編輯元素（設定/表單輸入、contenteditable）。
// xterm 的 helper textarea 不算（視為終端聚焦），故排除之。
function isEditableNonTerminal(el) {
  if (!el) return false;
  if (el.classList?.contains('xterm-helper-textarea')) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function extractInfoBoxValue(itemKey, output) {
  const cleaned = stripAnsi(output);
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && match[1].trim() === itemKey) {
      return match[2].trim() || t('common.noOutput');
    }
  }
  return cleaned || t('common.noOutput');
}

function getSwitchState(comp, output) {
  const cleaned = stripAnsi(output);
  if (comp.stateA?.match && cleaned.includes(comp.stateA.match)) {
    return 'A';
  }
  if (comp.stateB?.match && cleaned.includes(comp.stateB.match)) {
    return 'B';
  }
  return 'unknown';
}

function isValidControlPanelComponent(comp) {
  return comp && comp.id && ['info', 'switch', 'function'].includes(comp.type);
}

function sameHostConfig(a = {}, b = {}) {
  return a.host === b.host &&
    Number(a.port || 22) === Number(b.port || 22) &&
    a.username === b.username &&
    a.authMode === b.authMode &&
    (a.privateKeyPath || '') === (b.privateKeyPath || '') &&
    (a.certPath || '') === (b.certPath || '');
}

function renderSwitchBoxControl(comp, stateValue = 'loading') {
  const stateA = comp.stateA || {};
  const stateB = comp.stateB || {};
  const isA = stateValue === 'A';
  const isB = stateValue === 'B';
  const isUnknown = stateValue === 'unknown';
  const stateText = isA ? stateA.label : isB ? stateB.label : isUnknown ? 'Unknown State' : 'Loading';
  const disabled = stateValue === 'loading' || isUnknown;

  return `
    <div class="switch-box-body" style="display: flex; flex-direction: column; gap: 10px;">
      <div class="switch-box-status" data-id="${comp.id}" style="font-size: 11.5px; color: ${isUnknown ? '#f59e0b' : 'var(--color-text-muted)'}; font-weight: 700;">
        ${isUnknown ? 'Unknown: ' : ''}${stateText}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        <button type="button" class="no-drag switch-box-target-btn" data-id="${comp.id}" data-target="A" ${disabled || isA ? 'disabled' : ''} style="min-height: 28px; border: 1px solid ${isA ? (comp.color || 'var(--color-primary)') : 'var(--color-border)'}; background: ${isA ? (comp.color || 'var(--color-primary)') : 'transparent'}; color: ${isA ? '#fff' : 'var(--color-text)'}; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: ${disabled || isA ? 'default' : 'pointer'};">
          ${stateA.label || 'State A'}
        </button>
        <button type="button" class="no-drag switch-box-target-btn" data-id="${comp.id}" data-target="B" ${disabled || isB ? 'disabled' : ''} style="min-height: 28px; border: 1px solid ${isB ? (comp.color || 'var(--color-primary)') : 'var(--color-border)'}; background: ${isB ? (comp.color || 'var(--color-primary)') : 'transparent'}; color: ${isB ? '#fff' : 'var(--color-text)'}; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: ${disabled || isB ? 'default' : 'pointer'};">
          ${stateB.label || 'State B'}
        </button>
      </div>
    </div>
  `;
}

export class TermixApp extends HTMLElement {
  constructor() {
    super();
    this.disposeRouter = null;
    this.unsubscribeTerminal = null;
    this.unsubscribeTheme = null;
    this.unsubscribeKubernetesSession = null;
    this.sidebarTimer = null;
    this.runtimeEventOffs = [];
    this.controlPanelEditMode = false;
    this.snippetPanelEditMode = false;
    this.controlSidebarTab = 'control-panel';
    // 頂部 Workspace Tabs 的結構指紋；用於避免 terminalStore 高頻變更（如 PTY 輸出、
    // activePaneSessionKey 切換）導致整列 Tabs 不必要地重建與重綁事件（H4）。
    this.lastTabsFingerprint = null;
    this.handleShortcut = this.handleShortcut.bind(this);
  }

  // 計算頂部 Workspace Tabs 的結構指紋。
  // 涵蓋 renderTabs() 實際讀取、且會影響輸出 DOM 的所有狀態：
  //   - terminalStore：每個 workspace 的 id + label（依序）、activeWorkspaceId
  //   - kubernetesSessionStore：是否開啟 K8s 分頁、K8s 分頁顯示名稱、是否為 active
  // 任何上述狀態改變都會反映在指紋中；其餘高頻變更（sessions 輸出、activePaneSessionKey
  // 在非 K8s 情境下的切換等）不影響 Tabs，故指紋不變、可安全跳過重建。
  getTabsFingerprint() {
    const state = terminalStore.getState();
    const kubernetesState = kubernetesSessionStore.getState();
    const isKubernetesOpen = Boolean(kubernetesState.sessionOpen || kubernetesState.connectedCluster);
    const isKubernetesActive = state.activeWorkspaceId === KUBERNETES_SESSION_ID;
    const clusterLabel = isKubernetesOpen
      ? (kubernetesState.connectedCluster?.displayName || kubernetesState.connectedCluster?.contextName || 'Kubernetes')
      : '';
    const wsFingerprint = (state.workspaces || [])
      .map(ws => `${ws.id}::${ws.label}`)
      .join('|');
    return [
      state.activeWorkspaceId,
      isKubernetesOpen ? '1' : '0',
      isKubernetesActive ? '1' : '0',
      clusterLabel,
      wsFingerprint
    ].join('#');
  }

  connectedCallback() {
    // 檢查 localStorage 佔用，主動修剪過大歷史日誌，預先防範 QuotaExceeded 威脅
    try {
      const logsData = localStorage.getItem('termix-session-logs');
      if (logsData && logsData.length > 500000) { // 超過 500KB 即啟動自動修剪
        const logs = JSON.parse(logsData);
        if (Array.isArray(logs)) {
          // 只保留最近的 15 條，且修剪每條的 outputHtml 長度
          const truncatedLogs = logs.slice(-15);
          truncatedLogs.forEach(log => {
            if (log.outputHtml && log.outputHtml.length > 15000) {
              log.outputHtml = log.outputHtml.substring(log.outputHtml.length - 15000) + "\n(日誌過長，已自動修剪以確保系統安全)\n";
            }
          });
          localStorage.removeItem('termix-session-logs'); // 先刪除釋放空間，保障寫入安全
          localStorage.setItem('termix-session-logs', JSON.stringify(truncatedLogs));
        }
      }
    } catch (e) {
      console.warn('Failed to perform active telemetry on logs storage', e);
    }

    themeStore.getState().loadSettings();
    snippetStore.getState().loadSnippets();
    this.render();
    this.initRouter();
    this.setupTabListeners();
    this.setupSidebarListeners();
    this.setupSettingsListeners();
    document.addEventListener('keydown', this.handleShortcut);

    // 1. 訂閱 terminalStore 來動態重繪頂部 Workspace Tabs
    this.unsubscribeTerminal = terminalStore.subscribe((state, prevState) => {
      // 僅在 Tabs 結構指紋實際改變時才重建整列並重綁事件，避免 PTY 輸出等高頻
      // 無關狀態變更造成輸入失焦 / 效能損耗（H4）。
      const currentTabsFingerprint = this.getTabsFingerprint();
      if (currentTabsFingerprint !== this.lastTabsFingerprint) {
        this.renderTabs();
        this.setupTabListeners();
      }

      // 當活動 Pane Session Key 改變時，重新渲染側邊欄遙測資訊
      if (prevState && state.activePaneSessionKey !== prevState.activePaneSessionKey) {
        this.renderSidebarComponents();
      }
    });

    this.unsubscribeKubernetesSession = kubernetesSessionStore.subscribe(() => {
      const currentTabsFingerprint = this.getTabsFingerprint();
      if (currentTabsFingerprint !== this.lastTabsFingerprint) {
        this.renderTabs();
        this.setupTabListeners();
      }
    });
    if (getAppBinding('GetActiveKubernetesSession')) {
      kubernetesSessionStore.getState().restoreSession()
        .then((session) => {
          if (window.location.hash !== '#/kubernetes-session') return;
          if (session) {
            terminalStore.getState().setActiveWorkspaceId(KUBERNETES_SESSION_ID);
            terminalStore.getState().setActivePaneSessionKey(null);
            return;
          }
          terminalStore.getState().setActiveWorkspaceId('host-tab');
          window.location.hash = '#/hosts';
        })
        .catch((error) => {
          console.warn('還原 Kubernetes Session 失敗：', error);
          if (window.location.hash === '#/kubernetes-session') {
            terminalStore.getState().setActiveWorkspaceId('host-tab');
            window.location.hash = '#/hosts';
          }
        });
    }

    // 2. 訂閱 themeStore 來顯示/隱藏全域設定 Modal
    this.unsubscribeTheme = themeStore.subscribe((state) => {
      // 設定視窗「開啟」的那一刻快照目前主題，供按取消／✕ 時還原（預覽不落地）。
      if (state.settingsModalOpen && !this._settingsOpenPrev) {
        this.settingsOriginalTheme = state.theme;
      }
      this._settingsOpenPrev = state.settingsModalOpen;

      const modal = this.querySelector('#globalSettingsModal');
      const themeSelect = this.querySelector('#themeSelect');
      const localeSelect = this.querySelector('#localeSelect');
      const textSizeInput = this.querySelector('#terminalTextSizeInput');
      const localTerminalPathInput = this.querySelector('#localTerminalPathInput');
      if (modal) {
        modal.classList.toggle('hidden', !state.settingsModalOpen);
        if (!state.settingsModalOpen) this.stopRecordingShortcut();
        if (state.settingsModalOpen) {
          this.refreshShortcutRows();
          const logsContainer = this.querySelector('#tabDebugLogsContainer');
          if (logsContainer) {
            try {
              const logs = JSON.parse(localStorage.getItem('termix-tab-debug') || '[]');
              logsContainer.innerHTML = logs.map((log, idx) => {
                return `[${idx+1}] [${log.time}] val: ${log.value}\n   action: ${log.action}\n   stack: ${log.stack}`;
              }).join('\n\n') || t('app.settings.noDebugLogs');
            } catch (e) {
              logsContainer.innerHTML = t('app.settings.logReadError', { msg: e.message });
            }
          }
        }
      }
      if (themeSelect) {
        themeSelect.value = state.theme;
        this.syncThemeSwatches();
      }
      this.syncUiScale();
      if (localeSelect) {
        localeSelect.value = state.locale;
      }
      if (textSizeInput && document.activeElement !== textSizeInput) {
        textSizeInput.value = String(state.terminalTextSize);
      }
      if (localTerminalPathInput && document.activeElement !== localTerminalPathInput) {
        localTerminalPathInput.value = state.localTerminalPath;
      }
    });

    // 3. 註冊 Wails 全域設定事件
    this.runtimeEventOffs.push(onWailsEvent("open-global-settings", () => {
      themeStore.getState().setSettingsModalOpen(true);
    }));

    // 監聽終端輸出流（PTY 原始資料直通 xterm.js，不做任何轉換）
    this.runtimeEventOffs.push(onWailsEvent("terminal-output", (data) => {
      const state = terminalStore.getState();
      const sessionExists = !!state.sessions[data.key];
      if (!sessionExists) {
        return;
      }
      // 環形緩衝：限制前端鏡像的 outputHtml 上限，避免長時間運行 / 大量輸出造成記憶體無限成長 OOM。
      // 注意：此處僅截斷前端字串鏡像（用於日誌持久化），xterm.js 本身仍維持自身 scrollback，顯示行為不受影響。
      const MAX_FRONTEND_OUTPUT_LENGTH = 200000;
      const merged = (state.sessions[data.key].outputHtml || "") + data.chunk;
      state.sessions[data.key].outputHtml = merged.length > MAX_FRONTEND_OUTPUT_LENGTH
        ? merged.slice(merged.length - MAX_FRONTEND_OUTPUT_LENGTH)
        : merged;
      const term = state.xtermInstances[data.key];
      if (term) {
        term.write(data.chunk);
      }
    }));

    this.runtimeEventOffs.push(onWailsEvent("terminal-closed", (data) => {
      const key = data && data.key;
      if (!key) return;

      // 判斷此次關閉是否為使用者主動發起（closeWorkspace / closePane 會預先標記）。
      // 若非使用者主動關閉，視為遠端斷線（SSH 連線中斷）。
      const wasUserClosed = consumeUserClosed(key);

      // A. 使用者主動關閉 → 維持原本移除流程完全不變。
      if (wasUserClosed) {
        this.removeSessionFromWorkspaces(key);
        cleanupFrontendSession(key);
        this.routeAfterSessionRemoval();
        return;
      }

      // B. 異常斷線：若為可重連的遠端 SSH，就地在該 pane 啟動重連流程（不移除 pane）。
      const session = terminalStore.getState().sessions[key];
      if (isReconnectableSession(session)) {
        const started = beginReconnect(key, {
          onStatus: (statusKey, status) => {
            // 透過 live 的 terminal-page 元件更新對應 pane 的重連 overlay。
            const page = document.querySelector('terminal-page');
            if (page && typeof page.updateReconnectOverlay === 'function') {
              page.updateReconnectOverlay(statusKey, status);
            }
          }
        });
        if (started) {
          // 重連流程已接管此 pane，不移除、不清理；overlay 顯示「重新連線中…」。
          return;
        }
      }

      // C. 不可重連（本機 / 日誌回放 / 缺重連資訊）或無法啟動重連 → 維持原本移除 + 斷線提示。
      let disconnectedLabel = null;
      if (session && !session.isLogView && !session.isLocal && !(session.config && session.config.isLocal)) {
        const cfg = session.config || {};
        disconnectedLabel = cfg.alias || session.label || cfg.host || key;
      }

      this.removeSessionFromWorkspaces(key);
      cleanupFrontendSession(key);
      this.routeAfterSessionRemoval();

      if (disconnectedLabel) {
        this.showDisconnectNotice(disconnectedLabel);
      }
    }));

    // 4. 啟動背景遙測輪詢定時器 (每 15 秒)
    this.sidebarTimer = setInterval(() => {
      const sidebar = this.querySelector('#controlSidebar');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        this.triggerTelemetryPolling();
      }
    }, 15000);
  }

  disconnectedCallback() {
    if (this.unsubscribeTerminal) this.unsubscribeTerminal();
    if (this.unsubscribeTheme) this.unsubscribeTheme();
    if (this.unsubscribeKubernetesSession) this.unsubscribeKubernetesSession();
    if (this.sidebarTimer) clearInterval(this.sidebarTimer);
    document.removeEventListener('keydown', this.handleShortcut);
    this.runtimeEventOffs.forEach((off) => off());
    this.runtimeEventOffs = [];
    if (this.disposeRouter) this.disposeRouter();
    this.disposeRouter = null;
  }

  render() {
    const sidebarEditMode = this.controlSidebarTab === 'snippets' ? this.snippetPanelEditMode : this.controlPanelEditMode;
    const sidebarEditTitle = sidebarEditMode ? t('app.sidebar.finishArrange') : t('app.sidebar.editArrange');
    this.innerHTML = `
      <main class="shell" style="display: flex; flex-direction: column; height: calc(100vh / var(--ui-scale, 1)); width: calc(100vw / var(--ui-scale, 1)); overflow: hidden; background: var(--bg-main);">
        <!-- 頂部 TOPBAR -->
        <header class="topbar" style="display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 48px; border-bottom: 1px solid var(--color-border); background: var(--color-titlebar-bg); flex: 0 0 auto; --wails-draggable: drag;">
          <div class="titlebar-content" style="display: flex; align-items: center; flex: 1; min-width: 0; height: 100%; --wails-draggable: drag;">
            <div id="sessionTabs" class="session-tabs" style="flex: 0 1 auto; --wails-draggable: no-drag;">
              <!-- 動態渲染 Session Tabs，Vaults 固定在最左側 -->
            </div>
            <!-- 加大拖曳視窗的範圍：右側自適應空白拖曳區 -->
            <div class="topbar-drag-handle" style="flex: 1 1 auto; height: 100%; min-width: 20px; --wails-draggable: drag; cursor: default;"></div>
          </div>
          <button type="button" id="toggleControlSidebar" class="no-drag session-bar-control-btn" title="${t('app.topbar.toggleControlPanel')}" style="background: transparent; border: none; color: var(--color-subtext); cursor: pointer; padding: 6px; display: flex; align-items: center; justify-content: center; margin: 0; --wails-draggable: no-drag;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </header>

        <!-- 主要佈局核心 -->
        <section class="layout" style="display: flex; flex: 1; min-height: 0; width: 100%; position: relative; --wails-draggable: no-drag;">
          <!-- 路由視窗掛載點 -->
          <main id="outlet" style="flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; position: relative; --wails-draggable: no-drag;"></main>
          
          <!-- 側邊欄 (Layout 核心一體，預設 collapsed，由 style.css 控制寬度與動畫) -->
          <section id="controlSidebar" class="panel control-panel collapsed" style="display: flex; flex-direction: column;">
            <div class="control-sidebar-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); margin-bottom: 10px; flex: 0 0 auto;">
              <h2 style="font-size: 13px; font-weight: 700; color: var(--color-text); margin: 0;">${t('app.sidebar.console')}</h2>
              <button type="button" id="toggleControlPanelEditMode" class="no-drag control-panel-edit-btn ${sidebarEditMode ? 'active' : ''}" title="${sidebarEditTitle}" aria-pressed="${sidebarEditMode ? 'true' : 'false'}" style="background: transparent; border: none; padding: 6px; border-radius: 4px; color: ${sidebarEditMode ? 'var(--color-primary)' : 'var(--color-subtext)'}; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
            <div class="control-sidebar-tabs" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px; flex: 0 0 auto;">
              <button type="button" class="no-drag control-sidebar-tab-btn" data-tab="control-panel" aria-pressed="${this.controlSidebarTab === 'control-panel' ? 'true' : 'false'}" style="min-height: 30px; border: 1px solid ${this.controlSidebarTab === 'control-panel' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${this.controlSidebarTab === 'control-panel' ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'transparent'}; color: ${this.controlSidebarTab === 'control-panel' ? 'var(--color-primary)' : 'var(--color-text-muted)'}; border-radius: 5px; font-size: 11px; font-weight: 800; cursor: pointer;">CONTROL PANEL</button>
              <button type="button" class="no-drag control-sidebar-tab-btn" data-tab="snippets" aria-pressed="${this.controlSidebarTab === 'snippets' ? 'true' : 'false'}" style="min-height: 30px; border: 1px solid ${this.controlSidebarTab === 'snippets' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${this.controlSidebarTab === 'snippets' ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'transparent'}; color: ${this.controlSidebarTab === 'snippets' ? 'var(--color-primary)' : 'var(--color-text-muted)'}; border-radius: 5px; font-size: 11px; font-weight: 800; cursor: pointer;">SNIPPETS</button>
            </div>
            <!-- 主機自訂資訊卡 -->
            <div id="hostCustomInfoContainer" class="hidden" style="border: 1px solid var(--color-border); border-radius: 6px; padding: 12px 14px; background: color-mix(in srgb, var(--color-primary) 5%, transparent); margin-bottom: 14px; flex: 0 0 auto;">
              <h3 style="font-size: 12px; font-weight: 700; color: var(--color-primary); margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">${t('app.sidebar.hostInfo')}</h3>
              <div id="hostCustomInfoFields" style="display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 12px; color: var(--color-text);">
                <!-- 動態解析 Key-Value -->
              </div>
            </div>
            <div id="controlSidebarDynamicContent" style="display: flex; flex-direction: column; gap: 18px; flex: 1; overflow-y: auto; padding-right: 4px; min-height: 0;">
              <!-- 根據連線設定，動態渲染組件內容 -->
            </div>
          </section>
        </section>
      </main>

      <!-- Settings 彈窗 Modal -->
      <div id="globalSettingsModal" class="settings-modal hidden" role="dialog" aria-modal="true" style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 99999;">
        <div class="settings-dialog settings-dialog--tabbed" style="width: min(660px, 100%); height: min(600px, 86vh); background: var(--dialog-bg); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
          <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="font-weight: 700; font-size: 14px; color: var(--color-text); margin: 0;">${t('app.settings.title')}</h2>
            <button type="button" id="closeGlobalSettings" class="no-drag btn-xs" style="background: transparent; border: none; cursor: pointer; color: var(--color-subtext); font-size: 16px;">&times;</button>
          </div>
          <div class="settings-main" style="display: flex; min-height: 0; flex: 1;">
            <nav class="settings-rail no-drag" aria-label="${t('app.settings.title')}" role="tablist">
              <button type="button" class="settings-tab active no-drag" data-settings-tab="appearance" role="tab" aria-selected="true"><i class="ti ti-palette" aria-hidden="true"></i><span>${t('app.settings.tab.appearance')}</span></button>
              <button type="button" class="settings-tab no-drag" data-settings-tab="terminal" role="tab" aria-selected="false"><i class="ti ti-terminal-2" aria-hidden="true"></i><span>${t('app.settings.tab.terminal')}</span></button>
              <button type="button" class="settings-tab no-drag" data-settings-tab="shortcuts" role="tab" aria-selected="false"><i class="ti ti-keyboard" aria-hidden="true"></i><span>${t('app.settings.tab.shortcuts')}</span></button>
              <button type="button" class="settings-tab no-drag" data-settings-tab="kubernetes" role="tab" aria-selected="false"><i class="ti ti-cloud" aria-hidden="true"></i><span>${t('app.settings.tab.kubernetes')}</span></button>
              <button type="button" class="settings-tab no-drag" data-settings-tab="general" role="tab" aria-selected="false"><i class="ti ti-settings" aria-hidden="true"></i><span>${t('app.settings.tab.general')}</span></button>
              <button type="button" class="settings-tab no-drag" data-settings-tab="advanced" role="tab" aria-selected="false"><i class="ti ti-tool" aria-hidden="true"></i><span>${t('app.settings.tab.advanced')}</span></button>
            </nav>
            <div class="settings-content">
              <section data-settings-panel="appearance" role="tabpanel">
                ${this.renderThemeAppearancePanel()}
              </section>
              <section data-settings-panel="terminal" role="tabpanel" hidden>
                <div style="display: grid; gap: 16px;">
                  <div style="display: flex; flex-direction: column; text-align: left; gap: 8px; font-size: 12px; color: var(--color-subtext);">
                    <span>${t('app.settings.textSize')}</span>
                    <div style="display: grid; grid-template-columns: 34px 1fr 34px; gap: 8px; align-items: center;">
                      <button type="button" id="terminalTextSizeMinus" class="no-drag" style="height: 34px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: 6px; font-weight: 700; cursor: pointer;">-</button>
                      <input type="number" id="terminalTextSizeInput" class="no-drag" min="9" max="24" step="0.5" value="${themeStore.getState().terminalTextSize}" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text); text-align: center; font-weight: 700;">
                      <button type="button" id="terminalTextSizePlus" class="no-drag" style="height: 34px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: 6px; font-weight: 700; cursor: pointer;">+</button>
                    </div>
                  </div>
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                    ${t('app.settings.localShell')}
                    <input type="text" id="localTerminalPathInput" class="no-drag" list="localTerminalPathOptions" value="${escapeHtml(themeStore.getState().localTerminalPath)}" autocomplete="off" spellcheck="false" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace;">
                    <datalist id="localTerminalPathOptions">
                      ${['/bin/bash', '/bin/csh', '/bin/dash', '/bin/ksh', '/bin/sh', '/bin/tcsh', '/bin/zsh'].map(path => `<option value="${path}"></option>`).join('')}
                    </datalist>
                    <small style="color: var(--color-text-muted);">${t('app.settings.localShellHint')}</small>
                  </label>
                </div>
              </section>
              <section data-settings-panel="kubernetes" role="tabpanel" hidden>
                <div style="display: grid; gap: 16px;">
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                    ${t('app.settings.k8s.kubeconfigPath')}
                    <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center;">
                      <input type="text" id="kubeconfigPathInput" class="no-drag" value="${escapeHtml(themeStore.getState().kubeconfigPath)}" placeholder="~/.kube/config" autocomplete="off" spellcheck="false" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace;">
                      <button type="button" id="kubeconfigBrowseBtn" class="no-drag" style="height: 34px; padding: 0 14px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: 6px; cursor: pointer; font-size: 12px;">${t('app.settings.k8s.browse')}</button>
                    </div>
                    <small style="color: var(--color-text-muted);">${t('app.settings.k8s.kubeconfigHint')}</small>
                  </label>
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                    ${t('app.settings.k8s.defaultNamespace')}
                    ${(() => {
                      const dns = themeStore.getState().defaultNamespace;
                      const isSpecific = Boolean(dns) && dns !== '*';
                      return `<select id="defaultNamespaceMode" class="no-drag" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                      <option value="all"${isSpecific ? '' : ' selected'}>${t('app.settings.k8s.defaultNamespaceAll')}</option>
                      <option value="specific"${isSpecific ? ' selected' : ''}>${t('app.settings.k8s.defaultNamespaceSpecific')}</option>
                    </select>
                    <input type="text" id="defaultNamespaceInput" class="no-drag"${isSpecific ? '' : ' hidden'} value="${escapeHtml(isSpecific ? dns : '')}" placeholder="my-namespace" autocomplete="off" spellcheck="false" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace;">`;
                    })()}
                    <small style="color: var(--color-text-muted);">${t('app.settings.k8s.defaultNamespaceHint')}</small>
                  </label>
                </div>
              </section>
              <section data-settings-panel="shortcuts" role="tabpanel" hidden>
                ${this.renderShortcutsPanel()}
              </section>
              <section data-settings-panel="general" role="tabpanel" hidden>
                <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                  ${t('app.settings.language')}
                  <select class="no-drag" id="localeSelect" style="background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                    <option value="en">English</option>
                    <option value="zh-Hant">繁體中文</option>
                    <option value="ja">日本語</option>
                  </select>
                </label>
              </section>
              <section data-settings-panel="advanced" role="tabpanel" hidden>
                <div style="font-size: 11px; font-weight: 700; color: var(--color-primary); margin-bottom: 6px; text-transform: uppercase;">${t('app.settings.debugLogs')}</div>
                <div id="tabDebugLogsContainer" style="font-family: monospace; font-size: 10px; color: var(--color-text-muted); max-height: 220px; overflow-y: auto; background: var(--input-bg); padding: 8px; border-radius: 4px; border: 1px solid var(--color-border); white-space: pre-wrap; word-break: break-all;">
                  ${t('app.settings.noDebugLogs')}
                </div>
              </section>
            </div>
          </div>
          <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 10px;">
            <button type="button" id="cancelGlobalSettings" class="no-drag" style="padding: 6px 14px; background: transparent; border: 1px solid var(--color-border); color: var(--color-text); border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">${t('common.cancel')}</button>
            <button type="button" id="saveGlobalSettings" class="no-drag primary" style="padding: 6px 14px; background: var(--color-primary); border: none; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">${t('app.settings.save')}</button>
          </div>
        </div>
      </div>
    `;
    this.renderTabs();
  }

  renderTabs() {
    const tabsContainer = this.querySelector('#sessionTabs');
    if (!tabsContainer) return;

    const state = terminalStore.getState();
    const workspaces = state.workspaces;
    const activeWorkspaceId = state.activeWorkspaceId;
    const kubernetesState = kubernetesSessionStore.getState();
    const isKubernetesOpen = Boolean(kubernetesState.sessionOpen || kubernetesState.connectedCluster);
    const isKubernetesActive = activeWorkspaceId === KUBERNETES_SESSION_ID;

    const sidebarToggle = this.querySelector('#toggleControlSidebar');
    if (isKubernetesActive) this.collapseControlSidebar();
    sidebarToggle?.classList.toggle('hidden', isKubernetesActive);

    const isVaultsActive = (activeWorkspaceId === 'host-tab' || activeWorkspaceId === 'control-panel-tab');

    // 1. Vaults 固定的最左側標籤
    let tabsHtml = `
      <div class="session-tab no-drag ${isVaultsActive ? 'active' : ''}" data-workspace-id="host-tab" style="font-weight: 700;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
          <line x1="6" y1="6" x2="6.01" y2="6"/>
          <line x1="6" y1="18" x2="6.01" y2="18"/>
        </svg>
        <span>Vaults</span>
      </div>
    `;

    // Kubernetes 是固定且唯一的應用程式分頁，不屬於 Terminal Workspace。
    if (isKubernetesOpen) {
      const clusterLabel = kubernetesState.connectedCluster?.displayName || kubernetesState.connectedCluster?.contextName || 'Kubernetes';
      tabsHtml += `
        <div class="session-tab kubernetes-session-tab no-drag ${isKubernetesActive ? 'active' : ''}" data-workspace-id="${KUBERNETES_SESSION_ID}" title="Kubernetes：${escapeHtml(clusterLabel)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5z"/><circle cx="12" cy="12" r="2.5"/>
          </svg>
          <span>${escapeHtml(clusterLabel)}</span>
          <button type="button" class="no-drag close-tab kubernetes-close-tab" data-workspace-id="${KUBERNETES_SESSION_ID}" title="${t('app.tab.closeKubernetes')}">&times;</button>
        </div>
      `;
    }

    // 所有 Terminal 工作區一律排列在 Kubernetes 右方。
    workspaces.forEach((ws) => {
      const isActive = ws.id === activeWorkspaceId;
      tabsHtml += `
        <div class="session-tab no-drag ${isActive ? 'active' : ''}" data-workspace-id="${ws.id}" title="${t('app.tab.title', { label: ws.label })}" draggable="true">
          <span>${ws.label}</span>
          <button type="button" class="no-drag close-tab" data-workspace-id="${ws.id}" title="${t('app.tab.closeWorkspace')}">&times;</button>
        </div>
      `;
    });

    // 3. 新增 Local Terminal 的 '+' 按鈕 (移除 inline樣式覆蓋，套用 style.css 經典 dashed邊框)
    tabsHtml += `
      <button type="button" id="addLocalTerminalTab" class="no-drag session-tab session-tab-add" title="${t('app.tab.addLocalTerminal')}" aria-label="${t('app.tab.addLocalTerminal')}">
        <span>+</span>
      </button>
    `;

    tabsContainer.innerHTML = tabsHtml;
    // 每次實際重建 Tabs 後同步指紋，作為後續訂閱比對的基準。
    this.lastTabsFingerprint = this.getTabsFingerprint();
  }

  initRouter() {
    const outlet = this.querySelector('#outlet');
    const routeController = mountLegacyRouter(outlet);
    this.disposeRouter = routeController.dispose;
  }

  setupTabListeners() {
    this.querySelectorAll('.session-tab:not(.session-tab-add)').forEach(tab => {
      const wsId = tab.getAttribute('data-workspace-id');

      // 1. 點擊切換活動分頁
      tab.addEventListener('click', () => {
        if (wsId === 'host-tab') {
          terminalStore.getState().setActiveWorkspaceId('host-tab');
          if (hostStore && hostStore.getState) {
            hostStore.getState().setSelectedTab('hosts');
          }
          window.location.hash = '#/hosts';
        } else if (wsId === KUBERNETES_SESSION_ID) {
          terminalStore.getState().setActiveWorkspaceId(KUBERNETES_SESSION_ID);
          terminalStore.getState().setActivePaneSessionKey(null);
          this.collapseControlSidebar();
          window.location.hash = '#/kubernetes-session';
        } else {
          terminalStore.getState().setActiveWorkspaceId(wsId);
          const state = terminalStore.getState();
          const ws = state.workspaces.find(w => w.id === wsId);
          const firstPane = ws?.columns[0]?.panes[0];
          terminalStore.getState().setActivePaneSessionKey(firstPane ? firstPane.sessionKey : null);
          window.location.hash = '#/terminal';
        }
      });

      // 2. 終端機連線分頁拖曳合併 (Drag & Drop) 邏輯
      if (wsId !== 'host-tab' && wsId !== KUBERNETES_SESSION_ID) {
        tab.addEventListener('dragstart', (e) => {
          tab.classList.add('tab-dragging');
          e.dataTransfer.setData('text/plain', wsId);
          e.dataTransfer.effectAllowed = 'move';
        });

        tab.addEventListener('dragend', () => {
          tab.classList.remove('tab-dragging');
          this.querySelectorAll('.session-tab').forEach(t => t.classList.remove('tab-drag-over'));
        });

        tab.addEventListener('dragover', (e) => {
          e.preventDefault(); // 允許 Drop
          e.dataTransfer.dropEffect = 'move';
          tab.classList.add('tab-drag-over');
        });

        tab.addEventListener('dragleave', () => {
          tab.classList.remove('tab-drag-over');
        });

        tab.addEventListener('drop', (e) => {
          e.preventDefault();
          tab.classList.remove('tab-drag-over');
          const sourceWsId = e.dataTransfer.getData('text/plain');
          if (sourceWsId && sourceWsId !== wsId) {
            this.mergeWorkspaces(sourceWsId, wsId);
          }
        });
      }
    });

    // 關閉分頁
    this.querySelectorAll('.close-tab').forEach(btn => {
      const wsId = btn.getAttribute('data-workspace-id');
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (wsId === KUBERNETES_SESSION_ID) {
          const wasActive = terminalStore.getState().activeWorkspaceId === KUBERNETES_SESSION_ID;
          try {
            await kubernetesSessionStore.getState().disconnect();
            if (wasActive) {
              terminalStore.getState().setActiveWorkspaceId('host-tab');
              terminalStore.getState().setActivePaneSessionKey(null);
              window.location.hash = '#/hosts';
            }
          } catch (error) {
            console.error('中斷 Kubernetes Session 失敗：', error);
          }
          return;
        }
        this.closeWorkspace(wsId);
      });
    });

    // 新增本機分頁
    const addLocalBtn = this.querySelector('#addLocalTerminalTab');
    if (addLocalBtn) {
      addLocalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.createLocalTerminal();
      });
    }
  }

  collapseControlSidebar() {
    const sidebar = this.querySelector('#controlSidebar');
    const toggleBtn = this.querySelector('#toggleControlSidebar');
    if (!sidebar) return;
    sidebar.classList.add('collapsed');
    sidebar.style.width = '';
    sidebar.style.flex = '';
    toggleBtn?.classList.remove('active');
  }

  // 將 sourceWsId 合併至 targetWsId 分割視窗中
  mergeWorkspaces(sourceWsId, targetWsId) {
    if (sourceWsId === targetWsId) return;
    if ([sourceWsId, targetWsId].includes('host-tab') || [sourceWsId, targetWsId].includes(KUBERNETES_SESSION_ID)) return;

    const state = terminalStore.getState();
    const workspaces = [...state.workspaces];
    const sourceWsIdx = workspaces.findIndex(w => w.id === sourceWsId);
    const targetWsIdx = workspaces.findIndex(w => w.id === targetWsId);

    if (sourceWsIdx === -1 || targetWsIdx === -1) return;

    const sourceWs = workspaces[sourceWsIdx];
    const targetWs = { ...workspaces[targetWsIdx] }; // 淺拷貝目標 Workspace 避免副作用

    // 將來源 Workspace 的所有 Columns 合併到目標 Workspace
    const mergedColumns = [
      ...targetWs.columns.map(col => ({ ...col })),
      ...sourceWs.columns.map(col => ({ ...col }))
    ];

    // 重新平均配置合併後的 Columns 寬度比例
    const numCols = mergedColumns.length;
    mergedColumns.forEach(col => {
      col.width = 100 / numCols;
    });

    targetWs.columns = mergedColumns;

    // 更新 workspaces 陣列
    workspaces[targetWsIdx] = targetWs;
    workspaces.splice(sourceWsIdx, 1); // 刪除來源分頁

    // 設定合併後新的活動 Pane Session Key
    const firstPane = targetWs.columns[0]?.panes[0];
    const activePaneKey = firstPane ? firstPane.sessionKey : null;

    // 寫入 Zustand 狀態以引發極速重繪，底層 PTY 與 xterm.js 實例將被 DOM 重新掛載（Re-parenting）保護
    terminalStore.setState({
      workspaces: workspaces,
      activeWorkspaceId: targetWs.id,
      activePaneSessionKey: activePaneKey
    });

    // 跳轉路由至終端機頁面
    window.location.hash = '#/terminal';
  }

  setupSidebarListeners() {
    const toggleBtn = this.querySelector('#toggleControlSidebar');
    const sidebar = this.querySelector('#controlSidebar');
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        toggleBtn.classList.toggle('active', !isCollapsed);
        
        if (!isCollapsed) {
          const savedWidth = localStorage.getItem('control-sidebar-width') || '340px';
          sidebar.style.width = savedWidth;
          sidebar.style.flex = `0 0 ${savedWidth}`;
          this.renderSidebarComponents();
        } else {
          sidebar.style.width = '';
          sidebar.style.flex = '';
        }
      });
    }

    const editBtn = this.querySelector('#toggleControlPanelEditMode');
    if (editBtn && sidebar) {
      editBtn.addEventListener('click', () => {
        if (this.controlSidebarTab === 'snippets') {
          this.snippetPanelEditMode = !this.snippetPanelEditMode;
          this.controlPanelEditMode = false;
        } else {
          this.controlPanelEditMode = !this.controlPanelEditMode;
          this.snippetPanelEditMode = false;
        }
        sidebar.classList.remove('collapsed');
        sidebar.style.width = localStorage.getItem('control-sidebar-width') || '340px';
        sidebar.style.flex = `0 0 ${sidebar.style.width}`;
        this.updateControlSidebarTabUI();
        this.renderSidebarComponents();
      });
    }

    this.querySelectorAll('.control-sidebar-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') || 'control-panel';
        if (tab === this.controlSidebarTab) return;
        this.controlSidebarTab = tab;
        if (tab !== 'control-panel') this.controlPanelEditMode = false;
        if (tab !== 'snippets') this.snippetPanelEditMode = false;
        this.updateControlSidebarTabUI();
        this.renderSidebarComponents();
      });
    });
  }

  // 全域快捷鍵派發器：單一 keydown → 依平台生效表比對 → 派發到 handler。
  handleShortcut(event) {
    if (this._recordingAction) return; // 錄製中不派發（雙保險，錄製監聽已於 capture 階段吞鍵）
    const active = document.activeElement;
    // 焦點在「非終端」的可編輯欄位（設定/表單輸入）時，一律讓原生編輯行為生效，不攔截。
    // xterm 的 helper textarea 例外（視為終端聚焦，快捷鍵照常生效）。
    if (isEditableNonTerminal(active)) return;

    const platform = detectPlatform();
    const resolved = resolveShortcuts(themeStore.getState().shortcuts, platform);
    const match = matchShortcut(event, resolved, platform);
    if (!match) return;

    // 終端專屬動作（複製/貼上/全選）僅在終端聚焦時攔截；否則放行原生，
    // 避免在 Vaults 等頁面把 macOS ⌘C 複製頁面選字給吃掉。
    const inTerminal = Boolean(active?.classList?.contains('xterm-helper-textarea'));
    if (TERMINAL_ONLY_ACTIONS.has(match.actionId) && !inTerminal) return;

    const handler = this.getShortcutHandlers()[match.actionId];
    if (!handler) return;
    event.preventDefault();
    handler(match);
  }

  // actionId → 動作。分頁類動作直接 click 對應的 .session-tab（重用既有切換/關閉 handler，
  // 涵蓋 Vaults／Kubernetes／Workspace 三種特殊分頁），不重寫切換語意。
  getShortcutHandlers() {
    return {
      nextTab: () => this.focusTabByOffset(1),
      prevTab: () => this.focusTabByOffset(-1),
      closeTab: () => this.closeActiveTab(),
      newLocalTerminal: () => this.createLocalTerminal(),
      openSnippets: () => this.openSnippets(),
      openSettings: () => themeStore.getState().setSettingsModalOpen(true),
      copy: () => this.copyTerminalSelection(),
      paste: () => this.pasteToTerminal(),
      selectAll: () => this.selectAllInTerminal(),
      [TAB_INDEX_ACTION_ID]: (m) => this.focusTabByIndex(m.index),
    };
  }

  // 當前作用中的 xterm 實例（活動 pane）；無則回傳 null。
  getActiveTerm() {
    const state = terminalStore.getState();
    return state.xtermInstances[state.activePaneSessionKey] || null;
  }

  copyTerminalSelection() {
    const term = this.getActiveTerm();
    if (!term || !term.hasSelection()) return;
    setClipboardText(term.getSelection());
  }

  // 經 term.paste() 走既有 onData 路徑（含 bracketed paste / reconnect 緩衝 / 廣播）。
  // 剪貼簿讀取走 Wails 原生 runtime，避免 WKWebView 擋掉 navigator.clipboard.readText 導致無法貼上。
  pasteToTerminal() {
    const term = this.getActiveTerm();
    if (!term) return;
    getClipboardText().then((text) => {
      if (text) term.paste(text);
    }).catch(() => {});
  }

  selectAllInTerminal() {
    const term = this.getActiveTerm();
    if (!term) return;
    term.selectAll();
  }

  getOrderedTabEls() {
    return [...this.querySelectorAll('#sessionTabs .session-tab:not(.session-tab-add)')];
  }

  focusTabByOffset(delta) {
    const tabs = this.getOrderedTabEls();
    if (tabs.length < 2) return;
    let idx = tabs.findIndex((el) => el.classList.contains('active'));
    if (idx === -1) idx = 0;
    tabs[(idx + delta + tabs.length) % tabs.length].click();
  }

  focusTabByIndex(n) {
    const el = this.getOrderedTabEls()[n - 1];
    if (el) el.click();
  }

  closeActiveTab() {
    const active = this.querySelector('#sessionTabs .session-tab.active');
    active?.querySelector('.close-tab')?.click();
  }

  openSnippets() {
    const sidebar = this.querySelector('#controlSidebar');
    const toggleBtn = this.querySelector('#toggleControlSidebar');
    if (!sidebar) return;
    sidebar.classList.remove('collapsed');
    sidebar.style.width = localStorage.getItem('control-sidebar-width') || '340px';
    sidebar.style.flex = `0 0 ${sidebar.style.width}`;
    if (toggleBtn) toggleBtn.classList.add('active');
    this.controlSidebarTab = 'snippets';
    this.controlPanelEditMode = false;
    this.snippetPanelEditMode = false;
    this.updateControlSidebarTabUI();
    this.renderSidebarComponents();
    const snippetSection = this.querySelector('#sidebarSnippetsSection');
    if (snippetSection) {
      snippetSection.scrollIntoView({ block: 'start' });
    }
  }

  updateControlSidebarTabUI() {
    this.querySelectorAll('.control-sidebar-tab-btn').forEach(btn => {
      const active = btn.getAttribute('data-tab') === this.controlSidebarTab;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.style.borderColor = active ? 'var(--color-primary)' : 'var(--color-border)';
      btn.style.background = active ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'transparent';
      btn.style.color = active ? 'var(--color-primary)' : 'var(--color-text-muted)';
    });
    const editBtn = this.querySelector('#toggleControlPanelEditMode');
    if (editBtn) {
      const activeEditMode = this.controlSidebarTab === 'snippets' ? this.snippetPanelEditMode : this.controlPanelEditMode;
      editBtn.style.display = 'inline-flex';
      editBtn.style.color = activeEditMode ? 'var(--color-primary)' : 'var(--color-subtext)';
      editBtn.classList.toggle('active', activeEditMode);
      editBtn.setAttribute('aria-pressed', activeEditMode ? 'true' : 'false');
      editBtn.setAttribute('title', activeEditMode ? t('app.sidebar.finishArrange') : t('app.sidebar.editArrange'));
    }
  }

  setupSettingsListeners() {
    const closeBtn = this.querySelector('#closeGlobalSettings');
    const cancelBtn = this.querySelector('#cancelGlobalSettings');
    const saveBtn = this.querySelector('#saveGlobalSettings');
    const select = this.querySelector('#themeSelect');
    const localeSelect = this.querySelector('#localeSelect');
    const textSizeInput = this.querySelector('#terminalTextSizeInput');
    const localTerminalPathInput = this.querySelector('#localTerminalPathInput');
    const kubeconfigPathInput = this.querySelector('#kubeconfigPathInput');
    const defaultNamespaceInput = this.querySelector('#defaultNamespaceInput');
    const defaultNamespaceMode = this.querySelector('#defaultNamespaceMode');
    const kubeconfigBrowseBtn = this.querySelector('#kubeconfigBrowseBtn');
    // 預設 namespace 模式：'all' 存 '*'（明確 All Namespaces，連線時覆蓋 context）；'specific' 存輸入值。
    const resolveDefaultNamespace = () => (defaultNamespaceMode && defaultNamespaceMode.value === 'specific' && defaultNamespaceInput)
      ? defaultNamespaceInput.value
      : '*';
    const textSizeMinus = this.querySelector('#terminalTextSizeMinus');
    const textSizePlus = this.querySelector('#terminalTextSizePlus');

    const close = () => {
      themeStore.getState().setSettingsModalOpen(false);
    };
    // 取消／✕：先把主題還原成開啟視窗時的快照（預覽不落地），再關閉。
    const cancelSettings = () => {
      const original = this.settingsOriginalTheme;
      if (original && original !== themeStore.getState().theme) {
        themeStore.getState().previewTheme(original);
      }
      close();
    };
    const clampTextSizeInput = () => {
      if (!textSizeInput) return themeStore.getState().terminalTextSize;
      const next = Math.min(24, Math.max(9, Math.round(Number(textSizeInput.value || themeStore.getState().terminalTextSize) * 2) / 2));
      textSizeInput.value = String(Number.isFinite(next) ? next : themeStore.getState().terminalTextSize);
      return Number(textSizeInput.value);
    };
    const stepTextSize = (delta) => {
      if (!textSizeInput) return;
      const current = clampTextSizeInput();
      textSizeInput.value = String(Math.min(24, Math.max(9, current + delta)));
    };

    if (closeBtn) closeBtn.addEventListener('click', cancelSettings);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelSettings);
    // 語言切換：立即套用（setLocale 會 reload）
    if (localeSelect) {
      localeSelect.addEventListener('change', () => {
        if (localeSelect.value !== themeStore.getState().locale) {
          themeStore.getState().setLocale(localeSelect.value);
        }
      });
    }
    if (textSizeMinus) textSizeMinus.addEventListener('click', () => stepTextSize(-0.5));
    if (textSizePlus) textSizePlus.addEventListener('click', () => stepTextSize(0.5));
    if (textSizeInput) {
      textSizeInput.addEventListener('blur', clampTextSizeInput);
      textSizeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clampTextSizeInput();
        }
      });
    }
    if (saveBtn && select && textSizeInput && localTerminalPathInput) {
      saveBtn.addEventListener('click', () => {
        themeStore.getState().saveSettings({
          theme: select.value,
          terminalTextSize: clampTextSizeInput(),
          localTerminalPath: localTerminalPathInput.value,
          kubeconfigPath: kubeconfigPathInput ? kubeconfigPathInput.value : themeStore.getState().kubeconfigPath,
          defaultNamespace: defaultNamespaceMode ? resolveDefaultNamespace() : themeStore.getState().defaultNamespace
        });
        close();
      });
    }
    // 預設 namespace 模式切換：選「指定」才顯示輸入框，選「All」則隱藏。
    if (defaultNamespaceMode && defaultNamespaceInput) {
      defaultNamespaceMode.addEventListener('change', () => {
        const specific = defaultNamespaceMode.value === 'specific';
        defaultNamespaceInput.hidden = !specific;
        if (specific) defaultNamespaceInput.focus();
      });
    }
    // kubeconfig 路徑「瀏覽」：開原生檔案選擇器，選定後填入輸入框（不立即存檔，按儲存才落地）。
    if (kubeconfigBrowseBtn && kubeconfigPathInput) {
      kubeconfigBrowseBtn.addEventListener('click', async () => {
        try {
          const selected = await HostAPI.selectFile(t('app.settings.k8s.kubeconfigBrowseTitle'));
          if (selected) kubeconfigPathInput.value = selected;
        } catch (e) {
          console.error('[TermiX] 選擇 kubeconfig 檔案失敗', e);
        }
      });
    }

    // 左側頁籤切換（純 DOM，不動 store）
    this.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.addEventListener('click', () => this.showSettingsTab(btn.getAttribute('data-settings-tab')));
    });

    // 快捷鍵面板：事件委派（錄製/單項還原/全部還原），避免每次重繪重綁。
    const shortcutsPanel = this.querySelector('[data-settings-panel="shortcuts"]');
    if (shortcutsPanel) {
      shortcutsPanel.addEventListener('click', (e) => {
        const recBtn = e.target.closest('[data-shortcut-record]');
        if (recBtn) { this.startRecordingShortcut(recBtn.getAttribute('data-shortcut-record')); return; }
        const resetBtn = e.target.closest('[data-shortcut-reset]');
        if (resetBtn) { this.resetShortcut(resetBtn.getAttribute('data-shortcut-reset')); return; }
        const conflictBtn = e.target.closest('[data-shortcut-conflict]');
        if (conflictBtn) { this.resolvePendingConflict(conflictBtn.getAttribute('data-shortcut-conflict') === 'reassign'); return; }
        if (e.target.closest('#shortcutsResetAll')) { this.resetAllShortcuts(); }
      });
    }

    // 主題色票：點擊即時「預覽」套用（不落地）；按儲存才寫入，按取消／✕ 還原成開啟時的主題。
    // previewTheme 會更新記憶體 state，subscribe 會回頭同步 #themeSelect 與色票選取態。
    this.querySelectorAll('[data-theme-opt]').forEach((el) => {
      el.addEventListener('click', () => {
        const value = el.getAttribute('data-theme-opt');
        if (select) select.value = value;
        themeStore.getState().previewTheme(value);
      });
    });
    this.syncThemeSwatches();

    // UI 介面縮放：點擊即時套用並持久化（zoom）；不影響終端機畫面。
    this.querySelectorAll('[data-ui-scale]').forEach((el) => {
      el.addEventListener('click', () => {
        themeStore.getState().setUiScale(Number(el.getAttribute('data-ui-scale')));
      });
    });
    this.syncUiScale();
  }

  // 依 themeStore.uiScale 同步介面縮放分段預設的選取態
  syncUiScale() {
    const current = themeStore.getState().uiScale;
    this.querySelectorAll('[data-ui-scale]').forEach((el) => {
      el.classList.toggle('selected', Number(el.getAttribute('data-ui-scale')) === current);
    });
  }

  // 依 #themeSelect 目前值同步基本模式列與色票的選取態
  syncThemeSwatches() {
    const select = this.querySelector('#themeSelect');
    if (!select) return;
    const value = select.value;
    this.querySelectorAll('[data-theme-opt]').forEach((el) => {
      const on = el.getAttribute('data-theme-opt') === value;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // 切換設定視窗的頁籤面板
  showSettingsTab(name) {
    if (!name) return;
    this.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      const on = btn.getAttribute('data-settings-tab') === name;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-settings-panel') !== name;
    });
    // 離開快捷鍵頁籤時中止進行中的錄製；進入時重繪一次以反映最新狀態。
    if (name !== 'shortcuts') this.stopRecordingShortcut();
    else this.refreshShortcutRows();
  }

  // ── Shortcuts 設定面板 ───────────────────────────────────────────────

  // 靜態外殼：標題列（含全部還原）＋ 由 refreshShortcutRows() 填入的列表容器。
  renderShortcutsPanel() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <small style="color:var(--color-text-muted);">${t('shortcut.recordHint')}</small>
        <button type="button" id="shortcutsResetAll" class="no-drag" style="padding:4px 10px; background:transparent; border:1px solid var(--color-border); color:var(--color-subtext); border-radius:4px; cursor:pointer; font-size:11px; font-weight:700;">${t('shortcut.resetAll')}</button>
      </div>
      <div id="shortcutsList">${this.renderShortcutRowsHtml()}</div>
    `;
  }

  renderShortcutRowsHtml() {
    const platform = detectPlatform();
    const overrides = themeStore.getState().shortcuts;
    const resolved = resolveShortcuts(overrides, platform);
    let html = '';
    // 衝突橫幅（內嵌處理，不用彈窗——設定視窗 z-index 高於通用 confirmDialog）。
    if (this._pendingConflict) {
      const labelOf = (id) => t(SHORTCUT_ACTIONS.find((a) => a.id === id).labelKey);
      const { actionId, conflictId } = this._pendingConflict;
      html += `
        <div style="border:1px solid var(--color-primary); background:color-mix(in srgb, var(--color-primary) 12%, transparent); border-radius:6px; padding:10px 12px; margin-bottom:6px;">
          <div style="font-size:12px; color:var(--color-text); white-space:pre-line; margin-bottom:8px;">${escapeHtml(t('shortcut.conflictMessage', { other: labelOf(conflictId), current: labelOf(actionId) }))}</div>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button type="button" data-shortcut-conflict="cancel" class="no-drag" style="padding:4px 12px; background:transparent; border:1px solid var(--color-border); color:var(--color-text); border-radius:4px; cursor:pointer; font-size:11px; font-weight:700;">${t('common.cancel')}</button>
            <button type="button" data-shortcut-conflict="reassign" class="no-drag" style="padding:4px 12px; background:var(--color-primary); border:none; color:#fff; border-radius:4px; cursor:pointer; font-size:11px; font-weight:700;">${t('common.confirm')}</button>
          </div>
        </div>`;
    }
    for (const cat of ['tabs', 'terminal', 'app']) {
      const actions = SHORTCUT_ACTIONS.filter((a) => a.category === cat);
      if (!actions.length) continue;
      html += `<div style="font-size:11px; font-weight:700; color:var(--color-primary); text-transform:uppercase; margin:14px 0 6px;">${t('shortcut.category.' + cat)}</div>`;
      for (const a of actions) {
        const overridden = Object.prototype.hasOwnProperty.call(overrides, a.id);
        html += this.renderShortcutRow(a.id, t(a.labelKey), resolved[a.id], { overridden, recording: this._recordingAction === a.id });
      }
      // 固定的分頁數字跳轉列，緊接在分頁類動作之後（不可重新綁定）。
      if (cat === 'tabs') {
        const prefix = platform === 'mac' ? '⌘' : 'Ctrl';
        html += this.renderShortcutRow(TAB_INDEX_ACTION_ID, t('shortcut.action.focusTabByIndex'), null, { fixed: true, fixedTokens: [prefix, '1…9'] });
      }
    }
    return html;
  }

  renderShortcutRow(actionId, label, binding, opts = {}) {
    const { overridden = false, recording = false, fixed = false, fixedTokens = [] } = opts;
    let right;
    if (fixed) {
      right = `${fixedTokens.map((tk) => `<kbd style="${KEYCAP_STYLE}">${escapeHtml(tk)}</kbd>`).join('<span style="opacity:.5;margin:0 1px;"></span>')}
        <span style="margin-left:8px; font-size:10px; color:var(--color-text-muted);">${t('shortcut.fixedHint')}</span>`;
    } else if (recording) {
      right = `<button type="button" data-shortcut-record="${actionId}" class="no-drag" style="padding:3px 10px; border:1px solid var(--color-primary); background:color-mix(in srgb, var(--color-primary) 14%, transparent); color:var(--color-primary); border-radius:5px; cursor:pointer; font-size:11px; font-weight:700;">${t('shortcut.recording')}</button>
        ${this._recordingNeedModifier ? `<span style="margin-left:8px; font-size:10px; color:var(--color-danger, #f87171);">${t('shortcut.needModifier')}</span>` : ''}`;
    } else {
      const tokens = bindingToTokens(binding, detectPlatform());
      const caps = tokens.length
        ? tokens.map((tk) => `<kbd style="${KEYCAP_STYLE}">${escapeHtml(tk)}</kbd>`).join('<span style="opacity:.5;margin:0 1px;"></span>')
        : `<span style="font-size:11px; color:var(--color-text-muted);">${t('shortcut.disabled')}</span>`;
      right = `<button type="button" data-shortcut-record="${actionId}" class="no-drag" title="${escapeHtml(label)}" style="display:inline-flex; align-items:center; gap:3px; padding:3px 8px; border:1px solid transparent; background:transparent; border-radius:5px; cursor:pointer;">${caps}</button>
        ${overridden ? `<button type="button" data-shortcut-reset="${actionId}" class="no-drag" title="${t('shortcut.resetTitle')}" style="margin-left:4px; width:22px; height:22px; border:none; background:transparent; color:var(--color-subtext); cursor:pointer;"><i class="ti ti-rotate-2" aria-hidden="true"></i></button>` : ''}`;
    }
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 0; border-bottom:1px solid color-mix(in srgb, var(--color-border) 45%, transparent);">
        <span style="font-size:12px; color:var(--color-text);">${escapeHtml(label)}</span>
        <span style="display:inline-flex; align-items:center; white-space:nowrap;">${right}</span>
      </div>
    `;
  }

  refreshShortcutRows() {
    const list = this.querySelector('#shortcutsList');
    if (list) list.innerHTML = this.renderShortcutRowsHtml();
  }

  startRecordingShortcut(actionId) {
    if (this._recordingAction) this.stopRecordingShortcut();
    this._recordingAction = actionId;
    this._recordingNeedModifier = false;
    // capture 階段攔截並吞掉按鍵，避免同時觸發全域派發器或送入 xterm。
    this._recordingKeydown = (e) => this.handleRecordingKey(e);
    document.addEventListener('keydown', this._recordingKeydown, true);
    this.refreshShortcutRows();
  }

  stopRecordingShortcut() {
    if (this._recordingKeydown) {
      document.removeEventListener('keydown', this._recordingKeydown, true);
      this._recordingKeydown = null;
    }
    this._recordingAction = null;
    this._recordingNeedModifier = false;
    this._pendingConflict = null;
  }

  handleRecordingKey(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return; // 等待完整組合
    const actionId = this._recordingAction;
    if (e.key === 'Escape') {
      this.stopRecordingShortcut();
      this.refreshShortcutRows();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.stopRecordingShortcut();
      this.finishRecordingShortcut(actionId, ''); // 停用
      return;
    }
    const binding = eventToBinding(e);
    if (!binding) {
      this._recordingNeedModifier = true;
      this.refreshShortcutRows();
      return;
    }
    this.stopRecordingShortcut();
    this.finishRecordingShortcut(actionId, binding);
  }

  finishRecordingShortcut(actionId, binding) {
    const platform = detectPlatform();
    const overrides = { ...themeStore.getState().shortcuts };
    const resolved = resolveShortcuts(overrides, platform);
    // 衝突偵測：另一動作目前生效為相同組合（停用 binding='' 不算衝突）。
    const conflictId = binding
      ? Object.keys(resolved).find((id) => id !== actionId && resolved[id] === binding)
      : undefined;
    if (conflictId) {
      // 交由內嵌衝突橫幅讓使用者確認改綁或取消。
      this._pendingConflict = { actionId, binding, conflictId };
      this.refreshShortcutRows();
      return;
    }
    setShortcutOverride(overrides, actionId, binding, platform);
    themeStore.getState().setShortcuts(overrides);
    this.refreshShortcutRows();
  }

  // 內嵌衝突橫幅的回應：accept=改綁（停用被搶走的動作），否則放棄本次變更。
  resolvePendingConflict(accept) {
    const pending = this._pendingConflict;
    this._pendingConflict = null;
    if (accept && pending) {
      const platform = detectPlatform();
      const overrides = { ...themeStore.getState().shortcuts };
      setShortcutOverride(overrides, pending.conflictId, '', platform);
      setShortcutOverride(overrides, pending.actionId, pending.binding, platform);
      themeStore.getState().setShortcuts(overrides);
    }
    this.refreshShortcutRows();
  }

  resetShortcut(actionId) {
    const overrides = { ...themeStore.getState().shortcuts };
    delete overrides[actionId];
    themeStore.getState().setShortcuts(overrides);
    this.refreshShortcutRows();
  }

  resetAllShortcuts() {
    themeStore.getState().setShortcuts({});
    this.refreshShortcutRows();
  }

  // 外觀頁籤：基本模式列（系統/淺色/深色）＋分組色票，並保留隱藏 <select> 供既有儲存邏輯讀取
  renderThemeAppearancePanel() {
    const modes = [
      ['system', 'ti-device-desktop', 'app.settings.mode.system'],
      ['light', 'ti-sun', 'app.settings.mode.light'],
      ['dark', 'ti-moon', 'app.settings.mode.dark']
    ];
    const groups = [
      ['app.theme.group.standard', [
        ['termix', '#121315', '#9eff2b', 'app.theme.termix'],
        ['graphite', '#15171a', '#a3b0c2', 'app.theme.graphite'],
        ['forest', '#0f1f1a', '#34d399', 'app.theme.forest'],
        ['copper', '#261714', '#fb923c', 'app.theme.copper'],
        ['aurora', '#14162b', '#38bdf8', 'app.theme.aurora']
      ]],
      ['app.theme.group.tahoe', [
        ['tahoe', '#16212d', '#8fd8ff', 'app.theme.tahoe'],
        ['tahoe-glacier', '#091120', '#38bdf8', 'app.theme.tahoeGlacier'],
        ['tahoe-sunset', '#1e110d', '#f97316', 'app.theme.tahoeSunset'],
        ['tahoe-nebula', '#090514', '#a855f7', 'app.theme.tahoeNebula'],
        ['tahoe-forest', '#05140b', '#22c55e', 'app.theme.tahoeForest']
      ]],
      ['app.theme.group.glass', [
        ['glass-light', '#c7d2dd', '#5b6b7d', 'app.theme.glassLight'],
        ['glass-dark', '#1e293b', '#cbd5e1', 'app.theme.glassDark'],
        ['glass-violet', '#241b3a', '#c4b5fd', 'app.theme.glassViolet'],
        ['glass-emerald', '#0f2a22', '#6ee7b7', 'app.theme.glassEmerald'],
        ['glass-amber', '#2a1e0e', '#fdba74', 'app.theme.glassAmber'],
        ['glass-rose', '#2a1420', '#fda4c0', 'app.theme.glassRose']
      ]]
    ];
    const modeRow = modes.map(([id, icon, labelKey]) =>
      `<button type="button" class="theme-mode-btn no-drag" data-theme-opt="${id}" role="radio" aria-checked="false"><i class="ti ${icon}" aria-hidden="true"></i><span>${t(labelKey)}</span></button>`
    ).join('');
    const groupsHtml = groups.map(([titleKey, items]) => {
      const cards = items.map(([id, bg, ac, labelKey]) => {
        const label = t(labelKey);
        return `<button type="button" class="theme-swatch no-drag" data-theme-opt="${id}" role="radio" aria-checked="false" title="${escapeHtml(label)}">${this.themeSwatchDot(bg, ac)}<span>${escapeHtml(label)}</span><i class="ti ti-check theme-swatch-check" aria-hidden="true"></i></button>`;
      }).join('');
      return `<div class="theme-swatch-group"><div class="theme-swatch-group-title">${t(titleKey)}</div><div class="theme-swatch-grid">${cards}</div></div>`;
    }).join('');
    return `
      <p class="settings-panel-desc">${t('app.settings.themeLabel')}</p>
      <select class="no-drag" id="themeSelect" style="display: none;" aria-hidden="true" tabindex="-1">
        <option value="system">${t('app.theme.system')}</option>
        <option value="light">${t('app.theme.light')}</option>
        <option value="dark" selected>${t('app.theme.dark')}</option>
        <option value="termix">${t('app.theme.termix')}</option>
        <option value="graphite">${t('app.theme.graphite')}</option>
        <option value="forest">${t('app.theme.forest')}</option>
        <option value="copper">${t('app.theme.copper')}</option>
        <option value="aurora">${t('app.theme.aurora')}</option>
        <option value="tahoe">${t('app.theme.tahoe')}</option>
        <option value="tahoe-glacier">${t('app.theme.tahoeGlacier')}</option>
        <option value="tahoe-sunset">${t('app.theme.tahoeSunset')}</option>
        <option value="tahoe-nebula">${t('app.theme.tahoeNebula')}</option>
        <option value="tahoe-forest">${t('app.theme.tahoeForest')}</option>
        <option value="glass-light">${t('app.theme.glassLight')}</option>
        <option value="glass-violet">${t('app.theme.glassViolet')}</option>
        <option value="glass-emerald">${t('app.theme.glassEmerald')}</option>
        <option value="glass-amber">${t('app.theme.glassAmber')}</option>
        <option value="glass-rose">${t('app.theme.glassRose')}</option>
        <option value="glass-dark">${t('app.theme.glassDark')}</option>
      </select>
      <div class="theme-mode-row">${modeRow}</div>
      ${groupsHtml}
      <div class="theme-swatch-group">
        <div class="theme-swatch-group-title">${t('app.settings.uiScale')}</div>
        <div class="ui-scale-row">
          ${UI_SCALE_OPTIONS.map((s) => `<button type="button" class="ui-scale-btn no-drag" data-ui-scale="${s}">${Math.round(s * 100)}%</button>`).join('')}
        </div>
        <small style="display: block; margin-top: 8px; color: var(--color-text-muted); font-size: 11px;">${t('app.settings.uiScaleHint')}</small>
      </div>
    `;
  }

  themeSwatchDot(bg, ac) {
    const s = 26;
    const r = s / 2 - 1;
    const c = s / 2;
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" class="theme-swatch-dot" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="${bg}"></circle><path d="M ${c} 1 A ${r} ${r} 0 0 1 ${c} ${s - 1} Z" fill="${ac}"></path><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.18)"></circle></svg>`;
  }

  // ==========================================
  // 4. 側邊欄自訂遙測組件渲染與輪詢 (Telemetry Panel)
  // ==========================================
  renderSidebarComponents() {
    const sidebar = this.querySelector('#controlSidebar');
    const container = this.querySelector('#controlSidebarDynamicContent');
    const infoContainer = this.querySelector('#hostCustomInfoContainer');
    if (!sidebar || !container) return;

    // 摺疊時不進行渲染，節省效能
    if (sidebar.classList.contains('collapsed')) return;

    const state = terminalStore.getState();
    const activeKey = state.activePaneSessionKey;

    if (!activeKey || !state.sessions[activeKey]) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">${t('app.sidebar.noActiveConnection')}</div>`;
      if (infoContainer) infoContainer.classList.add('hidden');
      return;
    }

    const session = state.sessions[activeKey];
    if (session.isLogView) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">${t('app.sidebar.logViewUnsupported')}</div>`;
      if (infoContainer) infoContainer.classList.add('hidden');
      return;
    }

    const showSnippetsInControlPanel = session.isLocal || session.config?.showSnippetsInControlPanel !== false;
    if (this.controlSidebarTab === 'snippets') {
      if (!showSnippetsInControlPanel) {
        container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">${t('app.sidebar.snippetsDisabled')}</div>`;
      } else {
        container.innerHTML = this.renderSidebarSnippetsHtml() || `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">${t('app.sidebar.noSnippets')}</div>`;
      }
      if (infoContainer) infoContainer.classList.add('hidden');
      this.setupSidebarComponentListeners();
      return;
    }

    if (session.isLocal) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">${t('app.sidebar.localUnsupported')}</div>`;
      if (infoContainer) infoContainer.classList.add('hidden');
      return;
    }

    // 渲染主機自訂資訊卡
    this.renderHostCustomInfoUI();

    // 取得所有已啟動且可用的組件列表
    const rawCustomConfig = Array.isArray(session.config.customComponents) ? session.config.customComponents : [];

    // 系統預設自訂組件清單 (讀取 localStorage)
    const rawComps = localStorage.getItem('termix-custom-components');
    const availableComps = (rawComps ? JSON.parse(rawComps) : []).filter(isValidControlPanelComponent);
    const availableIds = new Set(availableComps.map((comp) => comp.id));
    const customConfig = rawCustomConfig.filter((item) => item && item.id && availableIds.has(item.id));
    const savedMap = new Map(customConfig.map((c, idx) => [c.id, { visible: c.visible, order: c.order ?? idx }]));

    const activeComponents = availableComps
      .filter(c => savedMap.has(c.id) ? savedMap.get(c.id).visible : false)
      .sort((a, b) => {
        const orderA = savedMap.has(a.id) ? savedMap.get(a.id).order : 9999;
        const orderB = savedMap.has(b.id) ? savedMap.get(b.id).order : 9999;
        return orderA - orderB;
    });

    if (activeComponents.length === 0) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">${t('app.sidebar.noComponents')}</div>`;
      this.setupSidebarComponentListeners();
      return;
    }

    container.innerHTML = activeComponents.map(comp => {
      const theme = getControlPanelThemeStyle(comp.color);
      if (comp.type === 'info') {
        session.infoBoxOutputs = session.infoBoxOutputs || {};
        const outputs = session.infoBoxOutputs[comp.id] || {};

        const itemsHtml = (comp.items || []).map(item => {
          const val = outputs[item.key];
          const safeKey = item.key.replace(/[^a-zA-Z0-9_-]/g, '_');
          const valHtml = val === undefined 
            ? `<span class="info-val-${comp.id}-${safeKey}"><div class="spinner-mini" style="width: 10px; height: 10px; border-width: 1.5px;"></div></span>`
            : `<span class="info-val-${comp.id}-${safeKey}">${val}</span>`;

          return `
            <div style="font-weight: 700; color: ${theme.color}; min-width: 80px; text-align: left;">${item.key}</div>
            <div style="color: var(--color-text); text-align: left; word-break: break-all; font-weight: 600;">${valHtml}</div>
          `;
        }).join('');

        // 觸發背景非同步查詢
        if (!session.infoBoxOutputs[comp.id]) {
          session.infoBoxOutputs[comp.id] = {};
          this.triggerInfoBoxQuery(activeKey, comp);
        }

        return `
          <div class="control-group-panel themed-control-panel ${this.controlPanelEditMode ? 'editing-mode' : ''}" data-id="${comp.id}" draggable="${this.controlPanelEditMode ? 'true' : 'false'}" style="${theme.panelStyle}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; width: 100%;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <h3 style="font-size: 12px; font-weight: 700; ${theme.titleStyle}; margin: 0; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${comp.name}</h3>
              </div>
              <button type="button" class="no-drag info-box-refresh-btn" data-id="${comp.id}" style="${theme.iconButtonStyle}; cursor: pointer; display: flex; padding: 3px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
              </button>
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 12px;">
              ${itemsHtml}
            </div>
          </div>
        `;
      } else if (comp.type === 'switch') {
        session.switchBoxStates = session.switchBoxStates || {};
        const current = session.switchBoxStates[comp.id] || 'loading';
        if (!session.switchBoxStates[comp.id]) {
          session.switchBoxStates[comp.id] = 'loading';
          this.refreshSwitchBoxState(activeKey, comp);
        }
        return `
          <div class="control-group-panel themed-control-panel ${this.controlPanelEditMode ? 'editing-mode' : ''}" data-id="${comp.id}" draggable="${this.controlPanelEditMode ? 'true' : 'false'}" style="${theme.panelStyle}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <h3 style="font-size: 12px; font-weight: 700; ${theme.titleStyle}; margin: 0; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${comp.name}</h3>
              </div>
              <button type="button" class="no-drag switch-box-refresh-btn" data-id="${comp.id}" style="${theme.iconButtonStyle}; cursor: pointer; display: flex; padding: 3px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
              </button>
            </div>
            ${renderSwitchBoxControl(comp, current)}
          </div>
        `;
      } else {
        // FunctionBox
        return `
          <div class="control-group-panel themed-control-panel ${this.controlPanelEditMode ? 'editing-mode' : ''}" data-id="${comp.id}" draggable="${this.controlPanelEditMode ? 'true' : 'false'}" style="${theme.panelStyle}; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
              <div style="text-align: left; min-width: 0; flex: 1;">
              <h3 style="font-size: 12px; font-weight: 700; ${theme.titleStyle}; margin: 0; text-transform: uppercase;">${comp.name}</h3>
              <span style="font-size: 10.5px; color: var(--color-text-muted); display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${comp.localCommand || comp.remoteCommand || ''}</span>
              </div>
            </div>
            <button type="button" class="no-drag run-function-btn" data-id="${comp.id}" style="${theme.actionButtonStyle}; padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer; margin-left: 10px;">${t('app.sidebar.run')}</button>
          </div>
        `;
      }
    }).join('');

    this.setupSidebarComponentListeners();
  }

  renderSidebarSnippetsHtml() {
    const snippets = snippetStore.getState().snippets || [];
    const listHtml = snippets.map(snippet => `
      <div class="sidebar-snippet-item control-group-panel ${this.snippetPanelEditMode ? 'editing-mode' : ''}" data-snippet-id="${snippet.id}" draggable="${this.snippetPanelEditMode ? 'true' : 'false'}" style="border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent); background: color-mix(in srgb, var(--color-primary) 6%, transparent); border-radius: 6px; padding: 10px; display: grid; gap: 8px; cursor: ${this.snippetPanelEditMode ? 'grab' : 'default'};">
        <div style="display: flex; justify-content: space-between; gap: 8px; align-items: center;">
          <div style="font-size: 12px; font-weight: 800; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">${escapeHtml(snippet.name)}</div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <button type="button" class="no-drag sidebar-snippet-paste-btn" data-snippet-id="${snippet.id}" style="min-height: 28px; border: 1px solid var(--color-primary); background: transparent; color: var(--color-primary); border-radius: 4px; font-size: 11px; font-weight: 800; cursor: pointer;">PASTE</button>
          <button type="button" class="no-drag sidebar-snippet-run-btn" data-snippet-id="${snippet.id}" style="min-height: 28px; border: none; background: var(--color-primary); color: #fff; border-radius: 4px; font-size: 11px; font-weight: 800; cursor: pointer;">RUN</button>
        </div>
      </div>
    `).join('');

    return `
      <section id="sidebarSnippetsSection" style="display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 15%, transparent); padding-bottom: 14px;">
        ${listHtml || `<div style="color: var(--color-text-muted); font-size: 12.5px; text-align: left;">${t('app.sidebar.noSnippets')}</div>`}
      </section>
    `;
  }

  renderHostCustomInfoUI() {
    const infoContainer = this.querySelector('#hostCustomInfoContainer');
    const fieldsContainer = this.querySelector('#hostCustomInfoFields');
    if (!infoContainer || !fieldsContainer) return;

    const state = terminalStore.getState();
    const activeKey = state.activePaneSessionKey;
    if (!activeKey || !state.sessions[activeKey]) {
      infoContainer.classList.add('hidden');
      return;
    }

    const session = state.sessions[activeKey];
    if (!session.config.enableCustomQuery) {
      infoContainer.classList.add('hidden');
      return;
    }

    infoContainer.classList.remove('hidden');

    if (session.customInfo) {
      const keys = Object.keys(session.customInfo);
      if (keys.length === 0) {
        fieldsContainer.innerHTML = `<div style="grid-column: span 2; color: var(--color-text-muted); font-style: italic; font-size: 11px; padding: 4px 0;">${t('app.sidebar.noCustomQueryFields')}</div>`;
      } else {
        fieldsContainer.innerHTML = keys.map(key => {
          return `
            <div style="font-weight: 700; color: var(--color-primary); min-width: 90px; text-align: left;">${key}</div>
            <div style="color: var(--color-text); text-align: left; word-break: break-all; font-weight: 600;">${session.customInfo[key]}</div>
          `;
        }).join('');
      }
    } else {
      fieldsContainer.innerHTML = `<div style="grid-column: span 2; display: flex; align-items: center; gap: 6px; color: var(--color-text-muted); font-size: 11px;"><div class="spinner-mini" style="width: 10px; height: 10px;"></div>${t('app.sidebar.loading')}</div>`;
      // 發起非同步自訂查詢
      this.triggerHostCustomQuery(activeKey);
    }
  }

  async triggerHostCustomQuery(sessionKey) {
    const state = terminalStore.getState();
    const session = state.sessions[sessionKey];
    if (!session || !session.config.enableCustomQuery || !session.config.customQueryScript) return;

    try {
      const res = await TerminalAPI.executeSessionCommand(sessionKey, session.config.customQueryScript);
      const customInfo = {};
      if (res.success && res.output) {
        // 解析 KEY=VALUE
        res.output.split('\n').forEach(line => {
          const parts = line.split('=');
          if (parts.length >= 2) {
            customInfo[parts[0].trim()] = parts.slice(1).join('=').trim();
          }
        });
      }
      session.customInfo = customInfo;
      if (terminalStore.getState().activePaneSessionKey === sessionKey) {
        this.renderHostCustomInfoUI();
      }
    } catch (e) {
      session.customInfo = {};
      this.renderHostCustomInfoUI();
    }
  }

  triggerInfoBoxQuery(sessionKey, comp) {
    const state = terminalStore.getState();
    const session = state.sessions[sessionKey];
    if (!session) return;

    session.infoBoxOutputs = session.infoBoxOutputs || {};
    session.infoBoxOutputs[comp.id] = session.infoBoxOutputs[comp.id] || {};

    (comp.items || []).forEach(async (item) => {
      session.infoBoxOutputs[comp.id][item.key] = undefined; // loading
      this.updateInfoBoxFieldUI(comp.id, item.key, null);

      try {
        const res = await TerminalAPI.executeSessionCommandIsolated(sessionKey, item.command);
        let val = t('common.noOutput');
        if (res.success && res.output) {
          val = extractInfoBoxValue(item.key, res.output);
        }
        if (session.infoBoxOutputs[comp.id]) {
          session.infoBoxOutputs[comp.id][item.key] = val;
          terminalStore.getState().updateSession(sessionKey, {
            infoBoxOutputs: { ...session.infoBoxOutputs }
          });
          if (terminalStore.getState().activePaneSessionKey === sessionKey) {
            this.updateInfoBoxFieldUI(comp.id, item.key, val);
          }
        }
      } catch (e) {
        if (session.infoBoxOutputs[comp.id]) {
          session.infoBoxOutputs[comp.id][item.key] = 'Error';
          terminalStore.getState().updateSession(sessionKey, {
            infoBoxOutputs: { ...session.infoBoxOutputs }
          });
          this.updateInfoBoxFieldUI(comp.id, item.key, 'Error');
        }
      }
    });
  }

  updateInfoBoxFieldUI(compId, itemKey, value) {
    const safeKey = itemKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const el = this.querySelector(`.info-val-${compId}-${safeKey}`);
    if (!el) return;

    if (value === null) {
      el.innerHTML = `<div class="spinner-mini" style="width: 10px; height: 10px; border-width: 1.5px;"></div>`;
    } else {
      el.textContent = value;
    }
  }

  async refreshSwitchBoxState(sessionKey, comp) {
    const session = terminalStore.getState().sessions[sessionKey];
    if (!session || !comp.queryCommand) return;

    try {
      const res = await TerminalAPI.executeSessionCommandIsolated(sessionKey, comp.queryCommand);
      const nextState = res.success ? getSwitchState(comp, res.output || '') : 'unknown';
      this.setSwitchBoxState(sessionKey, comp.id, nextState);
    } catch (e) {
      this.setSwitchBoxState(sessionKey, comp.id, 'unknown');
    }
  }

  setSwitchBoxState(sessionKey, compId, stateValue) {
    const session = terminalStore.getState().sessions[sessionKey];
    if (!session) return;
    const switchBoxStates = { ...(session.switchBoxStates || {}), [compId]: stateValue };
    terminalStore.getState().updateSession(sessionKey, { switchBoxStates });
    if (terminalStore.getState().activePaneSessionKey === sessionKey) {
      this.renderSidebarComponents();
    }
  }

  triggerTelemetryPolling() {
    const state = terminalStore.getState();
    const activeKey = state.activePaneSessionKey;
    const session = activeKey ? state.sessions[activeKey] : null;
    if (!activeKey || !session || session.isLocal || session.isLogView) return;

    const customConfig = session.config.customComponents || [];
    const visibleComponentIds = new Set(customConfig.filter((item) => item.visible).map((item) => item.id));
    const rawComps = localStorage.getItem('termix-custom-components');
    const comps = rawComps ? JSON.parse(rawComps) : [];
    comps
      .filter((comp) => visibleComponentIds.has(comp.id))
      .forEach((comp) => {
        if (comp.type === 'info') {
          this.triggerInfoBoxQuery(activeKey, comp);
        } else if (comp.type === 'switch') {
          this.refreshSwitchBoxState(activeKey, comp);
        }
      });
  }

  setupSidebarComponentListeners() {
    // 1. InfoBox Refresh 整理
    this.querySelectorAll('.info-box-refresh-btn').forEach(btn => {
      const compId = btn.getAttribute('data-id');
      btn.addEventListener('click', () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const rawComps = localStorage.getItem('termix-custom-components');
        const comps = rawComps ? JSON.parse(rawComps) : [];
        const comp = comps.find(c => c.id === compId);
        if (activeKey && comp) {
          this.triggerInfoBoxQuery(activeKey, comp);
        }
      });
    });

    // 2. FunctionBox 執行
    this.querySelectorAll('.run-function-btn').forEach(btn => {
      const compId = btn.getAttribute('data-id');
      btn.addEventListener('click', async () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const rawComps = localStorage.getItem('termix-custom-components');
        const comps = rawComps ? JSON.parse(rawComps) : [];
        const comp = comps.find(c => c.id === compId);
        if (!activeKey || !comp) return;

        try {
          const result = await executeFunctionBox(comp, activeKey);
          if (!result.success) {
            const message = result.phase === 'remote'
              ? t('app.functionBox.remoteFailed', { error: result.error })
              : result.phase === 'export'
                ? t('app.functionBox.exportFailed', { error: result.error })
                : t('app.functionBox.sandboxFailed', { error: result.error });
            showToast(message, { type: 'error', title: t('app.functionBox.failTitle') });
            return;
          }
          // 過長輸出不塞進 toast，僅顯示完成摘要（輸出已寫入既有日誌/終端）。
          showToast(t('app.functionBox.done', { name: comp.title || comp.name || comp.id }), { type: 'success' });
        } catch (e) {
          showToast(t('app.functionBox.error', { error: String(e) }), { type: 'error', title: t('app.functionBox.failTitle') });
        }
      });
    });

    this.querySelectorAll('.switch-box-refresh-btn').forEach(btn => {
      const compId = btn.getAttribute('data-id');
      btn.addEventListener('click', () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const comp = this.getActiveControlPanelComponents().find(c => c.id === compId);
        if (activeKey && comp) {
          this.setSwitchBoxState(activeKey, comp.id, 'loading');
          this.refreshSwitchBoxState(activeKey, comp);
        }
      });
    });

    this.querySelectorAll('.switch-box-target-btn').forEach(btn => {
      const compId = btn.getAttribute('data-id');
      const target = btn.getAttribute('data-target');
      btn.addEventListener('click', async () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const comp = this.getActiveControlPanelComponents().find(c => c.id === compId);
        if (!activeKey || !comp) return;
        const command = target === 'A' ? comp.stateA?.command : comp.stateB?.command;
        if (!command) {
          showToast(t('app.switchBox.noCommand'), { type: 'error', title: 'SwitchBox' });
          return;
        }
        btn.disabled = true;
        try {
          const res = await TerminalAPI.executeSessionCommandIsolated(activeKey, command);
          if (!res.success) {
            showToast(t('app.switchBox.failed', { error: res.error || t('app.unknownError') }), { type: 'error', title: 'SwitchBox' });
            return;
          }
          this.setSwitchBoxState(activeKey, comp.id, 'loading');
          await this.refreshSwitchBoxState(activeKey, comp);
        } catch (e) {
          showToast(t('app.switchBox.error', { error: String(e) }), { type: 'error', title: 'SwitchBox' });
        } finally {
          btn.disabled = false;
        }
      });
    });

    this.querySelectorAll('.sidebar-snippet-paste-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const snippet = snippetStore.getState().snippets.find(item => item.id === btn.getAttribute('data-snippet-id'));
        if (!activeKey || !snippet) return;
        const res = await pasteSnippetToSession(activeKey, snippet);
        if (!res.success) showToast(t('app.snippet.pasteFailed', { error: res.error || t('app.unknownError') }), { type: 'error', title: 'Snippet' });
      });
    });

    this.querySelectorAll('.sidebar-snippet-run-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const snippet = snippetStore.getState().snippets.find(item => item.id === btn.getAttribute('data-snippet-id'));
        if (!activeKey || !snippet) return;
        const res = await runSnippetInSession(activeKey, snippet);
        if (!res.success) showToast(t('app.snippet.runFailed', { error: res.error || t('app.unknownError') }), { type: 'error', title: 'Snippet' });
      });
    });

    this.setupSidebarSnippetReorderListeners();
    this.setupControlPanelReorderListeners();
  }

  getActiveControlPanelComponents() {
    const state = terminalStore.getState();
    const activeKey = state.activePaneSessionKey;
    const session = activeKey ? state.sessions[activeKey] : null;
    if (!session) return [];
    const rawComps = localStorage.getItem('termix-custom-components');
    const availableComps = (rawComps ? JSON.parse(rawComps) : []).filter(isValidControlPanelComponent);
    const savedMap = new Map((session.config.customComponents || []).map((item, idx) => [item.id, { ...item, order: item.order ?? idx }]));
    return availableComps
      .filter((comp) => savedMap.get(comp.id)?.visible)
      .sort((a, b) => (savedMap.get(a.id)?.order ?? 9999) - (savedMap.get(b.id)?.order ?? 9999));
  }

  setupControlPanelReorderListeners() {
    const panels = Array.from(this.querySelectorAll('#controlSidebarDynamicContent .control-group-panel'));
    if (!this.controlPanelEditMode) return;

    const clearDragState = () => {
      this.querySelectorAll('.control-group-panel').forEach(item => {
        item.classList.remove('dragging', 'drag-over', 'drag-over-before', 'drag-over-after');
      });
    };

    panels.forEach(panel => {
      panel.addEventListener('dragstart', (e) => {
        const sourceId = panel.getAttribute('data-id');
        if (!sourceId) return;
        panel.classList.add('dragging');
        e.dataTransfer.setData('text/plain', sourceId);
        e.dataTransfer.effectAllowed = 'move';
      });
      panel.addEventListener('dragend', clearDragState);
      panel.addEventListener('dragover', (e) => {
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        const position = getControlPanelDropPosition(rect, e.clientX, e.clientY);
        panel.classList.add('drag-over');
        panel.classList.toggle('drag-over-before', position === 'before');
        panel.classList.toggle('drag-over-after', position === 'after');
        e.dataTransfer.dropEffect = 'move';
      });
      panel.addEventListener('dragleave', () => {
        panel.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
      });
      panel.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer.getData('text/plain');
        const targetId = panel.getAttribute('data-id');
        const rect = panel.getBoundingClientRect();
        const position = getControlPanelDropPosition(rect, e.clientX, e.clientY);
        clearDragState();
        if (!sourceId || !targetId || sourceId === targetId) return;
        this.reorderActiveControlPanelComponents(sourceId, targetId, position);
      });
    });
  }

  setupSidebarSnippetReorderListeners() {
    const items = Array.from(this.querySelectorAll('#controlSidebarDynamicContent .sidebar-snippet-item'));
    if (!this.snippetPanelEditMode) return;

    const clearDragState = () => {
      this.querySelectorAll('.sidebar-snippet-item').forEach(item => {
        item.classList.remove('dragging', 'drag-over', 'drag-over-before', 'drag-over-after');
      });
    };

    items.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        const sourceId = item.getAttribute('data-snippet-id');
        if (!sourceId) return;
        item.classList.add('dragging');
        e.dataTransfer.setData('text/plain', sourceId);
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', clearDragState);
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        const position = getControlPanelDropPosition(rect, e.clientX, e.clientY);
        item.classList.add('drag-over');
        item.classList.toggle('drag-over-before', position === 'before');
        item.classList.toggle('drag-over-after', position === 'after');
        e.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer.getData('text/plain');
        const targetId = item.getAttribute('data-snippet-id');
        const rect = item.getBoundingClientRect();
        const position = getControlPanelDropPosition(rect, e.clientX, e.clientY);
        clearDragState();
        if (!sourceId || !targetId || sourceId === targetId) return;
        this.reorderSidebarSnippets(sourceId, targetId, position);
      });
    });
  }

  reorderSidebarSnippets(sourceId, targetId, position = 'before') {
    const snippets = [...(snippetStore.getState().snippets || [])].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    const sourceIdx = snippets.findIndex(item => item.id === sourceId);
    const targetIdx = snippets.findIndex(item => item.id === targetId);
    if (sourceIdx < 0 || targetIdx < 0 || sourceId === targetId) return;

    const [moved] = snippets.splice(sourceIdx, 1);
    const nextTargetIdx = snippets.findIndex(item => item.id === targetId);
    const insertIdx = position === 'after' ? nextTargetIdx + 1 : nextTargetIdx;
    snippets.splice(insertIdx, 0, moved);
    snippetStore.getState().setSnippets(snippets.map((snippet, order) => ({ ...snippet, order })));
    this.renderSidebarComponents();
  }

  reorderActiveControlPanelComponents(sourceId, targetId, position = 'before') {
    const state = terminalStore.getState();
    const activeKey = state.activePaneSessionKey;
    const session = activeKey ? state.sessions[activeKey] : null;
    if (!session) return;

    const normalized = reorderControlPanelComponents(session.config.customComponents, sourceId, targetId, position);
    const changed = normalized.some((item, idx) => {
      const prev = session.config.customComponents?.[idx];
      return !prev || prev.id !== item.id || prev.order !== item.order;
    });
    if (!changed) return;

    const nextConfig = { ...session.config, customComponents: normalized };
    terminalStore.getState().updateSession(activeKey, { config: nextConfig });
    this.persistControlPanelOrderToHost(session.config, normalized);
    this.renderSidebarComponents();
  }

  persistControlPanelOrderToHost(sessionConfig, customComponents) {
    const hosts = hostStore.getState().hosts || [];
    const host = hosts.find(item => sameHostConfig(item.config || {}, sessionConfig || {}));
    if (!host) return;
    hostStore.getState().updateHost(host.id, {
      config: {
        ...host.config,
        customComponents: customComponents
          .filter(item => item.visible)
          .map((item, idx) => ({ id: item.id, visible: true, order: idx }))
      }
    });
  }

  async createLocalTerminal() {
    try {
      // 防禦性檢查：Wails Go Binding 是否可用（HMR 熱重載或瀏覽器直連時可能未就緒）
      if (!getAppBinding('StartLocalTerminal')) {
        console.warn('[TermiX Info] Wails Go 綁定尚未就緒。若您在瀏覽器直接連接 Vite 連接埠（如 5173）進行純前端開發，此為正常現象；若是在桌面 App 中，請嘗試重置或重新啟動應用程式（wails dev 熱重載期間偶爾會發生通訊中斷導致注入失敗）。');
        return;
      }

      const res = await TerminalAPI.startLocalTerminal(themeStore.getState().localTerminalPath);
      if (res.success) {
        const label = 'Local';
        const finalConfig = {
          host: 'localhost',
          port: 0,
          username: 'local',
          authMode: 'local',
          alias: label,
          isLocal: true,
          sessionId: 'sess_local_' + Date.now()
        };

        const wsId = 'ws_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
        const colId = 'col_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
        const newWorkspace = {
          id: wsId,
          label: label,
          isCustomLabel: false,
          columns: [
            {
              id: colId,
              width: 100,
              panes: [
                {
                  sessionKey: res.sessionKey,
                  height: 100
                }
              ]
            }
          ]
        };

        // 先新增 session 資料（不觸發結構變更）
        terminalStore.getState().addSession(res.sessionKey, {
          label,
          config: finalConfig,
          outputHtml: '',
          isSudo: false,
          infoBoxOutputs: {}
        });

        // 合併所有結構變更為一次性狀態更新，避免多次觸發 DOM 重建
        terminalStore.setState({
          workspaces: [...terminalStore.getState().workspaces, newWorkspace],
          workspaceCounter: terminalStore.getState().workspaceCounter + 1,
          activeWorkspaceId: wsId,
          activePaneSessionKey: res.sessionKey
        });

        window.location.hash = '#/terminal';
      } else {
        showToast(res.error || t('app.localTerminal.createFailed'), { type: 'error', title: t('app.localTerminal.createFailTitle') });
      }
    } catch (e) {
      showToast(t('app.errorWith', { error: String(e) }), { type: 'error' });
    }
  }

  async closeWorkspace(wsId) {
    const state = terminalStore.getState();
    const ws = state.workspaces.find(w => w.id === wsId);
    if (!ws) return;

    // 破壞性操作二次確認：若此分頁內含連線中的 session（非本機、非日誌回放），
    // 則關閉前先要求使用者確認；不含活躍連線的分頁可直接關閉。
    const activeSessions = [];
    ws.columns.forEach((col) => {
      col.panes.forEach((pane) => {
        const session = state.sessions[pane.sessionKey];
        if (session && !session.isLogView && !session.isLocal && !(session.config && session.config.isLocal)) {
          const cfg = session.config || {};
          activeSessions.push(cfg.alias || session.label || cfg.host || pane.sessionKey);
        }
      });
    });
    if (activeSessions.length > 0) {
      const list = activeSessions.join('、');
      if (!(await confirmDialog(t('app.closeWorkspace.confirm', { count: activeSessions.length, list }), { title: t('app.closeWorkspace.confirmTitle'), danger: true }))) {
        return;
      }
    }

    ws.columns.forEach((col) => {
      col.panes.forEach((pane) => {
        markSessionUserClosed(pane.sessionKey);
        TerminalAPI.closeTerminalSession(pane.sessionKey).catch(() => {});
        cleanupFrontendSession(pane.sessionKey);
      });
    });

    terminalStore.getState().removeWorkspace(wsId);

    if (state.activeWorkspaceId === wsId) {
      const remain = terminalStore.getState().workspaces;
      if (remain.length > 0) {
        terminalStore.getState().setActiveWorkspaceId(remain[0].id);
        const firstPane = remain[0].columns[0]?.panes[0];
        terminalStore.getState().setActivePaneSessionKey(firstPane ? firstPane.sessionKey : null);
        window.location.hash = '#/terminal';
      } else {
        terminalStore.getState().setActiveWorkspaceId('host-tab');
        terminalStore.getState().setActivePaneSessionKey(null);
        window.location.hash = '#/hosts';
      }
    }
  }

  removeSessionFromWorkspaces(sessionKey) {
    const state = terminalStore.getState();
    const workspaces = state.workspaces
      .map((ws) => {
        const columns = ws.columns
          .map((col) => ({
            ...col,
            panes: col.panes.filter((pane) => pane.sessionKey !== sessionKey)
          }))
          .filter((col) => col.panes.length > 0);
        const columnWidth = columns.length > 0 ? 100 / columns.length : 100;
        columns.forEach((col) => {
          col.width = columnWidth;
          const paneHeight = 100 / col.panes.length;
          col.panes.forEach((pane) => {
            pane.height = paneHeight;
          });
        });
        return { ...ws, columns };
      })
      .filter((ws) => ws.columns.length > 0);

    terminalStore.getState().setWorkspaces(workspaces);

    if (state.activePaneSessionKey === sessionKey) {
      const activeWs = workspaces.find((ws) => ws.id === state.activeWorkspaceId) || workspaces[0];
      const nextPane = activeWs?.columns[0]?.panes[0];
      terminalStore.getState().setActivePaneSessionKey(nextPane ? nextPane.sessionKey : null);
    }
  }

  // 遠端斷線提示：沿用通用 toast helper，顯示在右下角，3.5 秒後自動消失。
  // toast 直接掛在 document.body，避免受 App innerHTML 重繪影響。
  showDisconnectNotice(hostLabel) {
    showToast(t('app.disconnect.notice', { host: hostLabel }), {
      type: 'error',
      title: t('app.disconnect.title')
    });
  }

  routeAfterSessionRemoval() {
    const state = terminalStore.getState();
    if (state.workspaces.length === 0) {
      terminalStore.getState().setActiveWorkspaceId('host-tab');
      terminalStore.getState().setActivePaneSessionKey(null);
      window.location.hash = '#/hosts';
      return;
    }

    if (!state.workspaces.some((ws) => ws.id === state.activeWorkspaceId)) {
      const nextWs = state.workspaces[0];
      terminalStore.getState().setActiveWorkspaceId(nextWs.id);
      const firstPane = nextWs.columns[0]?.panes[0];
      terminalStore.getState().setActivePaneSessionKey(firstPane ? firstPane.sessionKey : null);
    }
  }
}

customElements.define('termix-app', TermixApp);
