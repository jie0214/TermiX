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
import { themeStore } from './stores/ThemeStore';
import { hostStore } from './modules/hostvault/HostStore';
import { snippetStore } from './modules/snippets/SnippetStore';
import { pasteSnippetToSession, runSnippetInSession } from './modules/snippets/SnippetRuntime';
import { kubernetesSessionStore, KUBERNETES_SESSION_ID } from './modules/kubernetes/KubernetesSessionStore';
import { getAppBinding } from './platform/wails/bindings.ts';
import { onWailsEvent } from './platform/wails/events.ts';
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

function extractInfoBoxValue(itemKey, output) {
  const cleaned = stripAnsi(output);
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && match[1].trim() === itemKey) {
      return match[2].trim() || '無輸出';
    }
  }
  return cleaned || '無輸出';
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
    this.handleSnippetShortcut = this.handleSnippetShortcut.bind(this);
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
    document.addEventListener('keydown', this.handleSnippetShortcut);

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
      const modal = this.querySelector('#globalSettingsModal');
      const themeSelect = this.querySelector('#themeSelect');
      const textSizeInput = this.querySelector('#terminalTextSizeInput');
      const localTerminalPathInput = this.querySelector('#localTerminalPathInput');
      if (modal) {
        modal.classList.toggle('hidden', !state.settingsModalOpen);
        if (state.settingsModalOpen) {
          const logsContainer = this.querySelector('#tabDebugLogsContainer');
          if (logsContainer) {
            try {
              const logs = JSON.parse(localStorage.getItem('termix-tab-debug') || '[]');
              logsContainer.innerHTML = logs.map((log, idx) => {
                return `[${idx+1}] [${log.time}] val: ${log.value}\n   action: ${log.action}\n   stack: ${log.stack}`;
              }).join('\n\n') || '無調試紀錄';
            } catch (e) {
              logsContainer.innerHTML = '讀取日誌出錯: ' + e.message;
            }
          }
        }
      }
      if (themeSelect) {
        themeSelect.value = state.theme;
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
    document.removeEventListener('keydown', this.handleSnippetShortcut);
    this.runtimeEventOffs.forEach((off) => off());
    this.runtimeEventOffs = [];
    if (this.disposeRouter) this.disposeRouter();
    this.disposeRouter = null;
  }

  render() {
    const sidebarEditMode = this.controlSidebarTab === 'snippets' ? this.snippetPanelEditMode : this.controlPanelEditMode;
    const sidebarEditTitle = sidebarEditMode ? '完成排列編輯' : '編輯方塊排列';
    this.innerHTML = `
      <main class="shell" style="display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; background: var(--bg-main);">
        <!-- 頂部 TOPBAR -->
        <header class="topbar" style="display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 48px; border-bottom: 1px solid var(--color-border); background: var(--color-titlebar-bg); flex: 0 0 auto; --wails-draggable: drag;">
          <div class="titlebar-content" style="display: flex; align-items: center; flex: 1; min-width: 0; height: 100%; --wails-draggable: drag;">
            <div id="sessionTabs" class="session-tabs" style="flex: 0 1 auto; --wails-draggable: no-drag;">
              <!-- 動態渲染 Session Tabs，Vaults 固定在最左側 -->
            </div>
            <!-- 加大拖曳視窗的範圍：右側自適應空白拖曳區 -->
            <div class="topbar-drag-handle" style="flex: 1 1 auto; height: 100%; min-width: 20px; --wails-draggable: drag; cursor: default;"></div>
          </div>
          <button type="button" id="toggleControlSidebar" class="no-drag session-bar-control-btn" title="展開/摺疊控制面板" style="background: transparent; border: none; color: var(--color-subtext); cursor: pointer; padding: 6px; display: flex; align-items: center; justify-content: center; margin: 0; --wails-draggable: no-drag;">
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
              <h2 style="font-size: 13px; font-weight: 700; color: var(--color-text); margin: 0;">控制台</h2>
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
              <h3 style="font-size: 12px; font-weight: 700; color: var(--color-primary); margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">主機資訊 (Host Info)</h3>
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
        <div class="settings-dialog" style="width: min(420px, 100%); background: var(--dialog-bg); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
          <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="font-weight: 700; font-size: 14px; color: var(--color-text); margin: 0;">Settings</h2>
            <button type="button" id="closeGlobalSettings" class="no-drag btn-xs" style="background: transparent; border: none; cursor: pointer; color: var(--color-subtext); font-size: 16px;">&times;</button>
          </div>
          <div class="settings-body" style="padding: 20px;">
            <div class="section-title" style="margin-bottom: 12px;">
              <h3 style="font-size: 13px; color: var(--color-primary); font-weight: 700; text-align: left; text-transform: uppercase;">Theme</h3>
            </div>
            <div style="display: grid; gap: 16px;">
              <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                外觀主題
                <select class="no-drag" id="themeSelect" style="background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  <option value="system">跟隨系統配色 (System)</option>
                  <option value="light">明亮風格 (Light)</option>
                  <option value="dark" selected>深色風格 (Dark)</option>
                  <option value="purple-dark">紫黑色風格 (Purple Dark)</option>
                  <option value="termix">TermiX 風格 (TermiX Style)</option>
                  <option value="tahoe">Tahoe 玻璃風格 (Tahoe Glass)</option>
                  <option value="graphite">石墨風格 (Graphite)</option>
                  <option value="forest">森林風格 (Forest)</option>
                  <option value="copper">銅色風格 (Copper)</option>
                  <option value="aurora">極光風格 (Aurora)</option>
                  <option value="tahoe-glacier">太浩冰川 (Tahoe Glacier)</option>
                  <option value="tahoe-sunset">太浩落日 (Tahoe Sunset)</option>
                  <option value="tahoe-nebula">太浩星雲 (Tahoe Nebula)</option>
                  <option value="tahoe-forest">太浩深林 (Tahoe Forest)</option>

                </select>
              </label>
              <div style="display: flex; flex-direction: column; text-align: left; gap: 8px; font-size: 12px; color: var(--color-subtext);">
                <span>Text Size</span>
                <div style="display: grid; grid-template-columns: 34px 1fr 34px; gap: 8px; align-items: center;">
                  <button type="button" id="terminalTextSizeMinus" class="no-drag" style="height: 34px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: 6px; font-weight: 700; cursor: pointer;">-</button>
                  <input type="number" id="terminalTextSizeInput" class="no-drag" min="9" max="24" step="0.5" value="${themeStore.getState().terminalTextSize}" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text); text-align: center; font-weight: 700;">
                  <button type="button" id="terminalTextSizePlus" class="no-drag" style="height: 34px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: 6px; font-weight: 700; cursor: pointer;">+</button>
                </div>
              </div>
              <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                Local Terminal Path
                <input type="text" id="localTerminalPathInput" class="no-drag" list="localTerminalPathOptions" value="${escapeHtml(themeStore.getState().localTerminalPath)}" autocomplete="off" spellcheck="false" style="height: 34px; box-sizing: border-box; background: var(--input-bg); border: 1px solid var(--input-border, var(--color-border)); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace;">
                <datalist id="localTerminalPathOptions">
                  ${['/bin/bash', '/bin/csh', '/bin/dash', '/bin/ksh', '/bin/sh', '/bin/tcsh', '/bin/zsh'].map(path => `<option value="${path}"></option>`).join('')}
                </datalist>
                <small style="color: var(--color-text-muted);">可直接輸入 Shell 的絕對路徑，或從右側下拉選單選擇。</small>
              </label>
              <div style="margin-top: 12px; border-top: 1px dashed var(--color-border); padding-top: 12px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--color-primary); margin-bottom: 6px; text-transform: uppercase;">Tab Debug Logs</div>
                <div id="tabDebugLogsContainer" style="font-family: monospace; font-size: 10px; color: var(--color-text-muted); max-height: 80px; overflow-y: auto; background: var(--input-bg); padding: 8px; border-radius: 4px; border: 1px solid var(--color-border); white-space: pre-wrap; word-break: break-all;">
                  無調試紀錄
                </div>
              </div>
            </div>
          </div>
          <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end;">
            <button type="button" id="saveGlobalSettings" class="no-drag primary" style="padding: 6px 14px; background: var(--color-primary); border: none; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">儲存設定</button>
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
          <button type="button" class="no-drag close-tab kubernetes-close-tab" data-workspace-id="${KUBERNETES_SESSION_ID}" title="關閉 Kubernetes 分頁">&times;</button>
        </div>
      `;
    }

    // 所有 Terminal 工作區一律排列在 Kubernetes 右方。
    workspaces.forEach((ws) => {
      const isActive = ws.id === activeWorkspaceId;
      tabsHtml += `
        <div class="session-tab no-drag ${isActive ? 'active' : ''}" data-workspace-id="${ws.id}" title="分頁: ${ws.label}" draggable="true">
          <span>${ws.label}</span>
          <button type="button" class="no-drag close-tab" data-workspace-id="${ws.id}" title="關閉分頁">&times;</button>
        </div>
      `;
    });

    // 3. 新增 Local Terminal 的 '+' 按鈕 (移除 inline樣式覆蓋，套用 style.css 經典 dashed邊框)
    tabsHtml += `
      <button type="button" id="addLocalTerminalTab" class="no-drag session-tab session-tab-add" title="新增 Local Terminal" aria-label="新增 Local Terminal">
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

  handleSnippetShortcut(event) {
    if (event.key !== '.' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
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
      editBtn.setAttribute('title', activeEditMode ? '完成排列編輯' : '編輯方塊排列');
    }
  }

  setupSettingsListeners() {
    const closeBtn = this.querySelector('#closeGlobalSettings');
    const cancelBtn = this.querySelector('#cancelGlobalSettings');
    const saveBtn = this.querySelector('#saveGlobalSettings');
    const select = this.querySelector('#themeSelect');
    const textSizeInput = this.querySelector('#terminalTextSizeInput');
    const localTerminalPathInput = this.querySelector('#localTerminalPathInput');
    const textSizeMinus = this.querySelector('#terminalTextSizeMinus');
    const textSizePlus = this.querySelector('#terminalTextSizePlus');

    const close = () => {
      themeStore.getState().setSettingsModalOpen(false);
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

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
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
          localTerminalPath: localTerminalPathInput.value
        });
        close();
      });
    }
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
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">未建立活動連線。</div>`;
      if (infoContainer) infoContainer.classList.add('hidden');
      return;
    }

    const session = state.sessions[activeKey];
    if (session.isLogView) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">歷史日誌回放分頁不支援控制面板。</div>`;
      if (infoContainer) infoContainer.classList.add('hidden');
      return;
    }

    const showSnippetsInControlPanel = session.isLocal || session.config?.showSnippetsInControlPanel !== false;
    if (this.controlSidebarTab === 'snippets') {
      if (!showSnippetsInControlPanel) {
        container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">此主機未啟用 Snippets 控制台顯示。請至 Edit Host 開啟。</div>`;
      } else {
        container.innerHTML = this.renderSidebarSnippetsHtml() || `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">尚未建立 Snippet。</div>`;
      }
      if (infoContainer) infoContainer.classList.add('hidden');
      this.setupSidebarComponentListeners();
      return;
    }

    if (session.isLocal) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">Local Terminal 不支援 Control Panel，請切換至 Snippets 頁籤。</div>`;
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
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">此主機未勾選任何側邊欄顯示組件。請至 Control Panel 勾選。</div>`;
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
            <button type="button" class="no-drag run-function-btn" data-id="${comp.id}" style="${theme.actionButtonStyle}; padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer; margin-left: 10px;">執行</button>
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
        ${listHtml || '<div style="color: var(--color-text-muted); font-size: 12.5px; text-align: left;">尚未建立 Snippet。</div>'}
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
        fieldsContainer.innerHTML = `<div style="grid-column: span 2; color: var(--color-text-muted); font-style: italic; font-size: 11px; padding: 4px 0;">無自訂查詢欄位。</div>`;
      } else {
        fieldsContainer.innerHTML = keys.map(key => {
          return `
            <div style="font-weight: 700; color: var(--color-primary); min-width: 90px; text-align: left;">${key}</div>
            <div style="color: var(--color-text); text-align: left; word-break: break-all; font-weight: 600;">${session.customInfo[key]}</div>
          `;
        }).join('');
      }
    } else {
      fieldsContainer.innerHTML = `<div style="grid-column: span 2; display: flex; align-items: center; gap: 6px; color: var(--color-text-muted); font-size: 11px;"><div class="spinner-mini" style="width: 10px; height: 10px;"></div>正在讀取...</div>`;
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
        let val = '無輸出';
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
              ? `遠端執行失敗: ${result.error}`
              : result.phase === 'export'
                ? `變數解析失敗: ${result.error}`
                : `安全沙箱阻攔或執行失敗: ${result.error}`;
            showToast(message, { type: 'error', title: 'FunctionBox 執行失敗' });
            return;
          }
          // 過長輸出不塞進 toast，僅顯示完成摘要（輸出已寫入既有日誌/終端）。
          showToast(`FunctionBox「${comp.title || comp.name || comp.id}」執行完成`, { type: 'success' });
        } catch (e) {
          showToast(`執行出錯: ${String(e)}`, { type: 'error', title: 'FunctionBox 執行失敗' });
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
          showToast('此狀態尚未設定切換指令。', { type: 'error', title: 'SwitchBox' });
          return;
        }
        btn.disabled = true;
        try {
          const res = await TerminalAPI.executeSessionCommandIsolated(activeKey, command);
          if (!res.success) {
            showToast(`SwitchBox 切換失敗：${res.error || '未知錯誤'}`, { type: 'error', title: 'SwitchBox' });
            return;
          }
          this.setSwitchBoxState(activeKey, comp.id, 'loading');
          await this.refreshSwitchBoxState(activeKey, comp);
        } catch (e) {
          showToast(`SwitchBox 切換出錯：${String(e)}`, { type: 'error', title: 'SwitchBox' });
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
        if (!res.success) showToast(`Snippet 貼上失敗：${res.error || '未知錯誤'}`, { type: 'error', title: 'Snippet' });
      });
    });

    this.querySelectorAll('.sidebar-snippet-run-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const state = terminalStore.getState();
        const activeKey = state.activePaneSessionKey;
        const snippet = snippetStore.getState().snippets.find(item => item.id === btn.getAttribute('data-snippet-id'));
        if (!activeKey || !snippet) return;
        const res = await runSnippetInSession(activeKey, snippet);
        if (!res.success) showToast(`Snippet 執行失敗：${res.error || '未知錯誤'}`, { type: 'error', title: 'Snippet' });
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
        showToast(res.error || '建立本機終端機失敗。', { type: 'error', title: '建立失敗' });
      }
    } catch (e) {
      showToast(`錯誤: ${String(e)}`, { type: 'error' });
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
      if (!(await confirmDialog(`此分頁仍有 ${activeSessions.length} 個連線中的 Session（${list}）。\n關閉後將中斷這些連線，確定要關閉嗎？`, { title: '確認關閉分頁', danger: true }))) {
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
    showToast(`與主機 ${hostLabel} 的連線已被遠端關閉或意外斷線。`, {
      type: 'error',
      title: '連線已中斷'
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
