import { controlPanelStore } from './ControlPanelStore';
import { ControlPanelAPI } from './ControlPanelAPI';
import { executeFunctionBox } from './ControlPanelRuntime';
import { terminalStore } from '../terminal/TerminalStore';
import { hostStore } from '../hostvault/HostStore';
import { showToast } from '../../components/feedback/toast';
import { confirmDialog } from '../../components/feedback/confirmDialog';

export class ControlPanelPage extends HTMLElement {
  constructor() {
    super();
    this.unsubscribe = null;
  }

  connectedCallback() {
    controlPanelStore.getState().loadComponents();
    this.render();
    this.setupListeners();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.unsubscribe = controlPanelStore.subscribe(() => {
      this.render();
      this.setupListeners();
    });
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
  }

  render() {
    const state = controlPanelStore.getState();
    const components = state.components;

    // 渲染左側子選單
    const menuTabs = [
      { id: 'hosts', label: 'Hosts', icon: `<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>` },
      { id: 'control-panel', label: 'Control Panel', icon: `<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>` },
      { id: 'integrations', label: 'Integrations', icon: `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>` },
      { id: 'kubernetes', label: 'Kubernetes', icon: `<path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5z"/><circle cx="12" cy="12" r="2.5"/><path d="M12 5.5v4M12 14.5v4M6.5 9l3.5 2M14 13l3.5 2M17.5 9 14 11M10 13l-3.5 2"/>` },
      { id: 'keychain', label: 'Keychain', icon: `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>` },
      { id: 'forwarding', label: 'Port Forwarding', icon: `<polyline points="17 11 21 7 17 3"/><path d="M3 17h8a4 4 0 0 0 4-4V7"/>` },
      { id: 'snippets', label: 'Snippets', icon: `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>` },
      { id: 'known_hosts', label: 'Known Hosts', icon: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>` },
      { id: 'logs', label: 'Logs', icon: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>` }
    ];

    const sidebarHtml = menuTabs.map(tab => {
      const activeClass = tab.id === 'control-panel' ? 'active' : '';
      return `
        <div class="vault-menu-item no-drag ${activeClass}" data-tab="${tab.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${tab.icon}
          </svg>
          <span>${tab.label}</span>
        </div>
      `;
    }).join('');

    // 卡片渲染 helper 函式
    const renderCard = (comp) => {
      let details = "";
      if (comp.type === 'info') {
        details = `InfoBox (${comp.items?.length || 0} items)`;
      } else if (comp.type === 'switch') {
        details = `SwitchBox: ${comp.description || ''}`;
      } else {
        details = `FunctionBox: ${comp.remoteCommand ? 'SSH ' : ''}${comp.localCommand ? 'Local' : ''}`;
      }

      return `
        <div class="vault-card edit-component-card text-left" data-id="${comp.id}" style="position: relative; display: flex; align-items: center; padding: 14px 16px; cursor: pointer;">
          <div class="vault-card-icon" style="background: rgba(23, 107, 135, 0.08); color: ${comp.color || '#176b87'};">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>
            </svg>
          </div>
          <div class="vault-card-info" style="flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; text-align: left; margin-left: 12px;">
            <span class="vault-card-title" style="font-size: 13.5px; font-weight: 700; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${comp.name}</span>
            <span class="vault-card-details" style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">${details}</span>
          </div>
          <button type="button" aria-label="編輯自訂物件" class="no-drag edit-component-btn" data-id="${comp.id}" title="編輯自訂物件" style="background: transparent; border: none; padding: 6px; border-radius: 4px; color: var(--color-subtext); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; margin-left: auto; min-width: 32px; min-height: 32px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      `;
    };

    const infoComponents = components.filter(c => c.type === 'info');
    const switchComponents = components.filter(c => c.type === 'switch');
    const functionComponents = components.filter(c => c.type === 'function');

    const drawerComp = state.selectedComponent || {
      name: '', type: 'function', color: '#176b87', remoteCommand: '', localCommand: '', exportVars: '', items: [],
      description: '', queryCommand: '', displayStyle: 'segmented', stateA: { label: '', match: '', command: '' }, stateB: { label: '', match: '', command: '' }
    };

    this.innerHTML = `
      <div id="controlPanelManagerPanel" class="host-vault-panel" style="display: flex; flex: 1; height: 100%; min-height: 0;">
        <!-- 第一欄：左側選單 -->
        <div class="vault-sub-sidebar">${sidebarHtml}</div>

        <!-- 第二欄：中央組件列表 -->
        <div class="vault-main-board" style="flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 20px; overflow-y: auto;">
          <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex: 0 0 auto;">
            <div style="display: flex; gap: 8px;">
              <button type="button" id="addComponentBtn" class="no-drag primary" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: var(--color-primary); border: none; border-radius: 4px; color: #fff; cursor: pointer;">+ NEW OBJECT</button>
              <div class="termix-dropdown no-drag">
                <button class="no-drag termix-dropdown-trigger" type="button" id="exportDropdownBtn" style="min-height: 32px; font-weight: 700; font-size: 12px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 14px; border-radius: 4px; cursor: pointer;" title="將組件備份匯出為 JSON 或 YAML 檔案">Export ▼</button>
                <div class="termix-dropdown-menu">
                  <div class="termix-dropdown-item" id="exportCompsJsonBtn">Export JSON</div>
                  <div class="termix-dropdown-item" id="exportCompsYamlBtn">Export YAML</div>
                </div>
              </div>
              <div class="termix-dropdown no-drag">
                <button class="no-drag termix-dropdown-trigger" type="button" id="importDropdownBtn" style="min-height: 32px; font-weight: 700; font-size: 12px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 14px; border-radius: 4px; cursor: pointer;" title="從備份的 JSON 或 YAML 檔案匯入組件">Import ▼</button>
                <div class="termix-dropdown-menu">
                  <div class="termix-dropdown-item" id="importCompsJsonBtn">Import JSON</div>
                  <div class="termix-dropdown-item" id="importCompsYamlBtn">Import YAML</div>
                </div>
              </div>
            </div>
            <!-- <div style="font-size: 13px; font-weight: 600; color: var(--color-text-muted);">控制面板組件管理器</div> -->
          </div>

          <div class="vault-scroll-content" style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 24px;">
            <!-- 看板 (InfoBox) -->
            <div class="vault-section">
              <h3 style="font-size: 13px; font-weight: 700; color: var(--color-primary); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">InfoBox</h3>
              <div id="infoComponentsGrid" class="vault-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 10px;">
                ${infoComponents.map(c => renderCard(c)).join('') || '<div style="color: var(--color-text-muted); font-size: 12.5px; padding: 10px 0; text-align: left;">尚無狀態看板，請點選上方「+ NEW OBJECT」建立</div>'}
              </div>
            </div>

            <!-- 開關 (SwitchBox) -->
            <div class="vault-section">
              <h3 style="font-size: 13px; font-weight: 700; color: var(--color-primary); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">SwitchBox</h3>
              <div id="switchComponentsGrid" class="vault-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 10px;">
                ${switchComponents.map(c => renderCard(c)).join('') || '<div style="color: var(--color-text-muted); font-size: 12.5px; padding: 10px 0; text-align: left;">尚無狀態切換物件，請點選上方「+ NEW OBJECT」建立</div>'}
              </div>
            </div>

            <!-- 快捷指令 (FunctionBox) -->
            <div class="vault-section">
              <h3 style="font-size: 13px; font-weight: 700; color: var(--color-primary); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">FunctionBox</h3>
              <div id="functionComponentsGrid" class="vault-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 10px;">
                ${functionComponents.map(c => renderCard(c)).join('') || '<div style="color: var(--color-text-muted); font-size: 12.5px; padding: 10px 0; text-align: left;">尚無快捷指令，請點選上方「+ NEW OBJECT」建立</div>'}
              </div>
            </div>
          </div>
        </div>

        <!-- 第三欄：滑出抽屜 -->
        <div id="componentDrawer" class="vault-drawer ${state.drawerOpen ? 'open' : ''}" style="width: 380px; background: #0c121f; border-left: 1px solid rgba(23,107,135,0.25); display: flex; flex-direction: column; transition: transform 0.3s ease; transform: ${state.drawerOpen ? 'translateX(0)' : 'translateX(100%)'}; position: relative;">
          ${!state.selectedComponent && !state.drawerOpen ? `
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--color-text-muted); text-align: center;">
              <div>
                <h3 style="margin-bottom: 8px; color: var(--color-text);">自訂控制組件</h3>
                <p style="font-size: 12.5px;">建立 InfoBox 狀態看板、SwitchBox 雙向開關或 FunctionBox 複合指令按鈕，實現高效率本機與 SSH 安全維運。</p>
              </div>
            </div>
          ` : `
            <div class="settings-dialog" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
              <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; justify-content: space-between; align-items: center;">
                <h2 id="componentModalTitle" style="font-size: 15px; font-weight: 700; color: var(--color-text);">${state.selectedComponent?.id ? '編輯自訂控制物件' : '新增自訂控制物件'}</h2>
                <button type="button" aria-label="關閉" id="closeComponentDrawer" class="no-drag icon-btn" style="font-size: 18px;">
                  &times;
                </button>
              </div>
              
              <form id="componentForm" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0;">
                <div class="settings-body" style="padding: 20px; flex: 1; overflow-y: auto;">
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 14px;">
                    物件名稱
                    <input class="no-drag" id="compNameInput" required value="${drawerComp.name || ''}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-weight: 600;">
                  </label>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      物件配色
                      <select class="no-drag" id="compColorSelect" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="#176b87" ${drawerComp.color === '#176b87' ? 'selected' : ''}>經典藍色</option>
                        <option value="#FF9900" ${drawerComp.color === '#FF9900' ? 'selected' : ''}>AWS 亮黃</option>
                        <option value="#E95420" ${drawerComp.color === '#E95420' ? 'selected' : ''}>Ubuntu 橘</option>
                        <option value="#2ecc71" ${drawerComp.color === '#2ecc71' ? 'selected' : ''}>生態綠色</option>
                        <option value="#ef4444" ${drawerComp.color === '#ef4444' ? 'selected' : ''}>警告紅色</option>
                        <option value="#a855f7" ${drawerComp.color === '#a855f7' ? 'selected' : ''}>絢麗紫色 (Nebula Purple)</option>
                        <option value="#ec4899" ${drawerComp.color === '#ec4899' ? 'selected' : ''}>玫瑰粉色 (Rose Pink)</option>
                        <option value="#06b6d4" ${drawerComp.color === '#06b6d4' ? 'selected' : ''}>冰川青色 (Glacier Cyan)</option>
                        <option value="#f59e0b" ${drawerComp.color === '#f59e0b' ? 'selected' : ''}>琥珀金色 (Amber Gold)</option>
                        <option value="#10b981" ${drawerComp.color === '#10b981' ? 'selected' : ''}>薄荷翡翠 (Mint Emerald)</option>
                        <option value="#6366f1" ${drawerComp.color === '#6366f1' ? 'selected' : ''}>靛藍星空 (Indigo Night)</option>
                        <option value="#f43f5e" ${drawerComp.color === '#f43f5e' ? 'selected' : ''}>珊瑚深紅 (Coral Crimson)</option>
                        <option value="#14b8a6" ${drawerComp.color === '#14b8a6' ? 'selected' : ''}>蒂芬妮綠 (Teal Horizon)</option>
                        <option value="#64748b" ${drawerComp.color === '#64748b' ? 'selected' : ''}>太空灰藍 (Space Slate)</option>
                      </select>
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      物件類型
                      <select class="no-drag" id="compTypeSelect" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="function" ${drawerComp.type === 'function' ? 'selected' : ''}>FunctionBox (指令)</option>
                        <option value="info" ${drawerComp.type === 'info' ? 'selected' : ''}>InfoBox (狀態)</option>
                        <option value="switch" ${drawerComp.type === 'switch' ? 'selected' : ''}>SwitchBox (開關)</option>
                      </select>
                    </label>
                  </div>

                  <!-- Type: FunctionBox 欄位 -->
                  <div id="compTypeFunctionBlock" style="display: ${drawerComp.type === 'function' ? 'block' : 'none'};">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      SSH 遠端指令
                      <textarea class="no-drag" id="compRemoteCommandInput" placeholder="例如：uptime && free -m" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace; height: 60px; resize: vertical;">${drawerComp.remoteCommand || ''}</textarea>
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      本地本機指令
                      <textarea class="no-drag" id="compLocalCommandInput" placeholder="例如：open https://google.com" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace; height: 60px; resize: vertical;">${drawerComp.localCommand || ''}</textarea>
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      導出環境變數名稱 (選填)
                      <input class="no-drag" id="compExportVarsInput" value="${drawerComp.exportVars || ''}" placeholder="例如：ID,IP (逗號分隔)" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                    </label>
                  </div>

                  <!-- Type: InfoBox 欄位 -->
                  <div id="compTypeInfoBlock" style="display: ${drawerComp.type === 'info' ? 'block' : 'none'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                      <span style="font-size: 12px; color: var(--color-text);">監控狀態項目</span>
                      <button type="button" id="addInfoItemBtn" class="no-drag" style="background: transparent; border: 1px solid var(--color-primary); color: var(--color-primary); padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">+ 新增項目</button>
                    </div>
                    <div id="infoItemsContainer" style="display: flex; flex-direction: column; gap: 8px;">
                      ${(drawerComp.items || []).map((item, idx) => `
                        <div class="info-item-row" style="display: flex; gap: 6px; align-items: center;" data-index="${idx}">
                          <input class="no-drag info-item-key" placeholder="Key (例如: CPU)" value="${item.key || ''}" style="width: 80px; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 6px 10px; border-radius: 6px; color: var(--color-text); font-size: 12px;">
                          <input class="no-drag info-item-cmd" placeholder="SSH Command (例如: top -b -n 1...)" value="${item.command || ''}" style="flex: 1; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 6px 10px; border-radius: 6px; color: var(--color-text); font-size: 12px; font-family: monospace;">
                          <button type="button" aria-label="移除" class="no-drag remove-info-item-btn icon-btn danger" style="font-size: 18px;">&times;</button>
                        </div>
                      `).join('')}
                    </div>
                  </div>

                  <!-- Type: SwitchBox 欄位 -->
                  <div id="compTypeSwitchBlock" style="display: ${drawerComp.type === 'switch' ? 'block' : 'none'};">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      說明描述
                      <input class="no-drag" id="compSwitchDescriptionInput" value="${drawerComp.description || ''}" placeholder="例如：切換正式與測試環境" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      查詢狀態 SSH 指令 (Query Command)
                      <textarea class="no-drag" id="compSwitchQueryInput" placeholder="例如：grep '^url:' /opt/goio/config.yaml" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace; height: 50px; resize: vertical;">${drawerComp.queryCommand || ''}</textarea>
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      顯示樣式
                      <select class="no-drag" id="compSwitchStyleSelect" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="segmented" ${drawerComp.displayStyle === 'segmented' ? 'selected' : ''}>Segmented Switch</option>
                        <option value="ios" ${drawerComp.displayStyle === 'ios' ? 'selected' : ''}>iOS Switch</option>
                        <option value="buttons" ${drawerComp.displayStyle === 'buttons' ? 'selected' : ''}>Button Toggle</option>
                        <option value="badge" ${drawerComp.displayStyle === 'badge' ? 'selected' : ''}>Badge</option>
                        <option value="indicator" ${drawerComp.displayStyle === 'indicator' ? 'selected' : ''}>Status Indicator</option>
                      </select>
                    </label>

                    <!-- State A 編輯區 -->
                    <div style="background: rgba(23, 107, 135, 0.04); border: 1px solid rgba(23, 107, 135, 0.15); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                      <div style="font-size: 11.5px; font-weight: 700; color: var(--color-primary); margin-bottom: 8px; text-transform: uppercase; text-align: left;">State A</div>
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                        <label style="display: flex; flex-direction: column; text-align: left; gap: 4px; font-size: 11px; color: var(--color-text-muted);">
                          顯示名稱
                          <input class="no-drag" id="compSwitchStateALabel" value="${drawerComp.stateA?.label || ''}" placeholder="Production" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.15); padding: 6px 10px; border-radius: 4px; color: var(--color-text); font-size: 11.5px;">
                        </label>
                        <label style="display: flex; flex-direction: column; text-align: left; gap: 4px; font-size: 11px; color: var(--color-text-muted);">
                          狀態匹配值 (Match)
                          <input class="no-drag" id="compSwitchStateAMatch" value="${drawerComp.stateA?.match || ''}" placeholder="rsgwin.com" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.15); padding: 6px 10px; border-radius: 4px; color: var(--color-text); font-size: 11.5px;">
                        </label>
                      </div>
                      <label style="display: flex; flex-direction: column; text-align: left; gap: 4px; font-size: 11px; color: var(--color-text-muted);">
                        切換為 State A 的 SSH 指令
                        <textarea class="no-drag" id="compSwitchStateACommand" placeholder="例如：sed -i 's/testing/production/g' config.yaml" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.15); padding: 6px 10px; border-radius: 4px; color: var(--color-text); font-family: monospace; font-size: 11.5px; height: 40px; resize: vertical;">${drawerComp.stateA?.command || ''}</textarea>
                      </label>
                    </div>

                    <!-- State B 編輯區 -->
                    <div style="background: rgba(23, 107, 135, 0.04); border: 1px solid rgba(23, 107, 135, 0.15); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                      <div style="font-size: 11.5px; font-weight: 700; color: var(--color-primary); margin-bottom: 8px; text-transform: uppercase; text-align: left;">State B</div>
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                        <label style="display: flex; flex-direction: column; text-align: left; gap: 4px; font-size: 11px; color: var(--color-text-muted);">
                          顯示名稱
                          <input class="no-drag" id="compSwitchStateBLabel" value="${drawerComp.stateB?.label || ''}" placeholder="Testing" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.15); padding: 6px 10px; border-radius: 4px; color: var(--color-text); font-size: 11.5px;">
                        </label>
                        <label style="display: flex; flex-direction: column; text-align: left; gap: 4px; font-size: 11px; color: var(--color-text-muted);">
                          狀態匹配值 (Match)
                          <input class="no-drag" id="compSwitchStateBMatch" value="${drawerComp.stateB?.match || ''}" placeholder="rsg-gamestar.com" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.15); padding: 6px 10px; border-radius: 4px; color: var(--color-text); font-size: 11.5px;">
                        </label>
                      </div>
                      <label style="display: flex; flex-direction: column; text-align: left; gap: 4px; font-size: 11px; color: var(--color-text-muted);">
                        切換為 State B 的 SSH 指令
                        <textarea class="no-drag" id="compSwitchStateBCommand" placeholder="例如：sed -i 's/production/testing/g' config.yaml" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.15); padding: 6px 10px; border-radius: 4px; color: var(--color-text); font-family: monospace; font-size: 11.5px; height: 40px; resize: vertical;">${drawerComp.stateB?.command || ''}</textarea>
                      </label>
                    </div>
                  </div>
                </div>

                <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 10px;">
                  <button type="submit" class="no-drag primary" style="flex: 1; min-height: 38px; font-weight: 700; background: var(--color-primary); border: none; border-radius: 6px; color: #fff; cursor: pointer;">儲存</button>
                  ${state.selectedComponent?.id ? `<button type="button" id="componentDeleteBtn" class="no-drag" style="min-height: 38px; font-weight: 700; background: #e74c3c; border: none; border-radius: 6px; color: #fff; padding: 0 16px; cursor: pointer;">Delete</button>` : ''}
                </div>
              </form>
            </div>
          `}
        </div>
      </div>
    `;
  }

  setupListeners() {
    const state = controlPanelStore.getState();

    // 1. 左側選單點擊切換
    this.querySelectorAll('.vault-menu-item').forEach(item => {
      const tabId = item.getAttribute('data-tab');
      item.addEventListener('click', () => {
        if (tabId === 'control-panel') return; // 已在當前控制面板頁面

        // 切換主機管理狀態分頁，並路由跳轉回 /hosts 進行集中式渲染
        hostStore.getState().setSelectedTab(tabId);
        window.location.hash = '#/hosts';
      });
    });

    // 2. 新增組件觸發
    const addCompBtn = this.querySelector('#addComponentBtn');
    if (addCompBtn) {
      addCompBtn.addEventListener('click', () => {
        controlPanelStore.getState().setSelectedComponent({ id: null, type: 'function', color: '#176b87' });
        controlPanelStore.getState().setDrawerOpen(true);
      });
    }

    // 3. 編輯組件觸發
    this.querySelectorAll('.edit-component-btn').forEach(btn => {
      const id = btn.getAttribute('data-id');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const comp = state.components.find(c => c.id === id);
        if (comp) {
          controlPanelStore.getState().setSelectedComponent(comp);
          controlPanelStore.getState().setDrawerOpen(true);
        }
      });
    });

    // 4. 點選組件卡片執行
    this.querySelectorAll('.edit-component-card').forEach(card => {
      const id = card.getAttribute('data-id');
      card.addEventListener('click', (e) => {
        if (e.target.closest('.edit-component-btn')) return;
        // 執行期間卡片標記為 busy，避免重複點擊。
        if (card.dataset.busy === '1') return;
        const comp = state.components.find(c => c.id === id);
        if (comp) {
          this.executeComponent(comp, card);
        }
      });
    });

    // 5. 關閉 Drawer
    const closeDrawerBtn = this.querySelector('#closeComponentDrawer');
    if (closeDrawerBtn) {
      closeDrawerBtn.addEventListener('click', () => {
        controlPanelStore.getState().setDrawerOpen(false);
        controlPanelStore.getState().setSelectedComponent(null);
      });
    }

    // 6. 刪除組件
    const deleteBtn = this.querySelector('#componentDeleteBtn');
    if (deleteBtn && state.selectedComponent?.id) {
      deleteBtn.addEventListener('click', () => {
        controlPanelStore.getState().deleteComponent(state.selectedComponent.id);
        controlPanelStore.getState().setDrawerOpen(false);
        controlPanelStore.getState().setSelectedComponent(null);
      });
    }

    // 7. 物件類型 Select 切換
    const typeSelect = this.querySelector('#compTypeSelect');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        const type = e.target.value;
        const funcBlock = this.querySelector('#compTypeFunctionBlock');
        const infoBlock = this.querySelector('#compTypeInfoBlock');
        const switchBlock = this.querySelector('#compTypeSwitchBlock');
        if (funcBlock) funcBlock.style.display = type === 'function' ? 'block' : 'none';
        if (infoBlock) infoBlock.style.display = type === 'info' ? 'block' : 'none';
        if (switchBlock) switchBlock.style.display = type === 'switch' ? 'block' : 'none';
      });
    }

    // 8. 新增 InfoBox 監控狀態項目
    const addInfoItemBtn = this.querySelector('#addInfoItemBtn');
    if (addInfoItemBtn) {
      addInfoItemBtn.addEventListener('click', () => {
        const container = this.querySelector('#infoItemsContainer');
        if (container) {
          const div = document.createElement('div');
          div.className = 'info-item-row';
          div.style.display = 'flex';
          div.style.gap = '6px';
          div.style.alignItems = 'center';
          div.innerHTML = `
            <input class="no-drag info-item-key" placeholder="Key" style="width: 80px; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 6px 10px; border-radius: 6px; color: var(--color-text); font-size: 12px;">
            <input class="no-drag info-item-cmd" placeholder="SSH Command" style="flex: 1; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 6px 10px; border-radius: 6px; color: var(--color-text); font-size: 12px; font-family: monospace;">
            <button type="button" aria-label="移除" class="no-drag remove-info-item-btn icon-btn danger" style="font-size: 18px;">&times;</button>
          `;
          container.appendChild(div);
          
          // 繫結刪除按鈕
          div.querySelector('.remove-info-item-btn').addEventListener('click', () => {
            div.remove();
          });
        }
      });
    }

    // 繫結現有 InfoBox 項目的刪除按鈕
    this.querySelectorAll('.remove-info-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.info-item-row').remove();
      });
    });

    // 9. 儲存組件
    const form = this.querySelector('#componentForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = this.querySelector('#compNameInput').value.trim();
        const color = this.querySelector('#compColorSelect').value;
        const type = this.querySelector('#compTypeSelect').value;

        let compData = { name, color, type };

        if (type === 'info') {
          const items = [];
          this.querySelectorAll('#infoItemsContainer .info-item-row').forEach(row => {
            const key = row.querySelector('.info-item-key').value.trim();
            const command = row.querySelector('.info-item-cmd').value.trim();
            if (key && command) {
              items.push({ key, command });
            }
          });

          if (items.length === 0) {
            showToast('狀態看板請至少填寫一個有效的監控項目。', { type: 'error' });
            return;
          }
          compData.items = items;
        } else if (type === 'switch') {
          const description = this.querySelector('#compSwitchDescriptionInput').value.trim();
          const queryCommand = this.querySelector('#compSwitchQueryInput').value.trim();
          const displayStyle = this.querySelector('#compSwitchStyleSelect').value;

          const stateALabel = this.querySelector('#compSwitchStateALabel').value.trim();
          const stateAMatch = this.querySelector('#compSwitchStateAMatch').value.trim();
          const stateACommand = this.querySelector('#compSwitchStateACommand').value.trim();

          const stateBLabel = this.querySelector('#compSwitchStateBLabel').value.trim();
          const stateBMatch = this.querySelector('#compSwitchStateBMatch').value.trim();
          const stateBCommand = this.querySelector('#compSwitchStateBCommand').value.trim();

          if (!queryCommand) {
            showToast('請填寫狀態查詢指令。', { type: 'error' });
            return;
          }
          if (!stateALabel || !stateBLabel) {
            showToast('請填寫 State A 與 State B 的顯示名稱。', { type: 'error' });
            return;
          }

          compData.description = description;
          compData.queryCommand = queryCommand;
          compData.displayStyle = displayStyle;
          compData.stateA = { label: stateALabel, match: stateAMatch, command: stateACommand };
          compData.stateB = { label: stateBLabel, match: stateBMatch, command: stateBCommand };
        } else {
          const remoteCommand = this.querySelector('#compRemoteCommandInput').value.trim();
          const localCommand = this.querySelector('#compLocalCommandInput').value.trim();
          const exportVars = this.querySelector('#compExportVarsInput').value.trim();

          if (!remoteCommand && !localCommand) {
            showToast('請至少填寫一個 SSH 或本地 OS 指令。', { type: 'error' });
            return;
          }
          compData.remoteCommand = remoteCommand;
          compData.localCommand = localCommand;
          compData.exportVars = exportVars;
        }

        if (state.selectedComponent?.id) {
          // 編輯模式
          controlPanelStore.getState().updateComponent(state.selectedComponent.id, compData);
        } else {
          // 新增模式
          const newId = 'c_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
          controlPanelStore.getState().addComponent({ id: newId, ...compData });
        }

        controlPanelStore.getState().setDrawerOpen(false);
        controlPanelStore.getState().setSelectedComponent(null);
      });
    }

    // 下拉選單點擊切換邏輯
    this.querySelectorAll('.termix-dropdown-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = trigger.nextElementSibling;
        this.querySelectorAll('.termix-dropdown-menu').forEach(m => {
          if (m !== menu) m.classList.remove('show');
        });
        menu.classList.toggle('show');
      });
    });

    // 點擊外部關閉選單
    const closeAllDropdowns = () => {
      this.querySelectorAll('.termix-dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
    };
    document.addEventListener('click', closeAllDropdowns);

    const performExport = async (format) => {
      try {
        const exportData = {
          components: JSON.parse(localStorage.getItem('termix-custom-components') || '[]')
        };
        const jsonStr = JSON.stringify(exportData, null, 2);
        const res = await ControlPanelAPI.saveBackupFile(
          `termix-components-backup-${new Date().toISOString().slice(0, 10)}`,
          jsonStr,
          format
        );
        if (res && res.success) {
          showToast('控制面板組件設定匯出成功，備份檔案已儲存。', { type: 'success' });
        } else {
          showToast('控制面板組件設定匯出失敗：' + (res ? res.error : '未知錯誤'), { type: 'error' });
        }
      } catch (err) {
        showToast('匯出設定失敗：' + err.message, { type: 'error' });
      }
    };

    const performImport = async (format) => {
      try {
        const res = await ControlPanelAPI.readBackupFile(format);
        if (!res || !res.success) {
          showToast('讀取備份檔案失敗：' + (res ? res.error : '未知錯誤'), { type: 'error' });
          return;
        }

        const data = JSON.parse(res.output);
        if (!data || !data.components) {
          showToast('無效的備份檔案格式（必須包含 components 自訂組件設定）！', { type: 'error' });
          return;
        }

        if (!(await confirmDialog('匯入將會與您現有的自訂控制面板組件合併並去重。是否確定繼續？', { title: '確認匯入' }))) {
          return;
        }

        if (data.components) {
          const rawComps = localStorage.getItem('termix-custom-components');
          const currentComps = rawComps ? JSON.parse(rawComps) : [];
          data.components.forEach(newC => {
            const idx = currentComps.findIndex(c => c.id === newC.id);
            if (idx >= 0) {
              currentComps[idx] = newC;
            } else {
              currentComps.push(newC);
            }
          });
          localStorage.setItem('termix-custom-components', JSON.stringify(currentComps));
        }

        showToast('控制面板組件設定匯入成功！', { type: 'success' });
        controlPanelStore.getState().loadComponents();
        this.render();
        this.setupListeners();
      } catch (err) {
        showToast('匯入設定失敗：' + err.message, { type: 'error' });
      }
    };

    // 17. 備份設定匯出 JSON/YAML
    const exportJsonBtn = this.querySelector('#exportCompsJsonBtn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => performExport('json'));
    }
    const exportYamlBtn = this.querySelector('#exportCompsYamlBtn');
    if (exportYamlBtn) {
      exportYamlBtn.addEventListener('click', () => performExport('yaml'));
    }

    // 18. 備份設定匯入 JSON/YAML
    const importJsonBtn = this.querySelector('#importCompsJsonBtn');
    if (importJsonBtn) {
      importJsonBtn.addEventListener('click', () => performImport('json'));
    }
    const importYamlBtn = this.querySelector('#importCompsYamlBtn');
    if (importYamlBtn) {
      importYamlBtn.addEventListener('click', () => performImport('yaml'));
    }
  }

  async executeComponent(comp, card = null) {
    if (comp.type === 'switch') {
      showToast('SwitchBox 狀態切換組件會在終端機側邊欄中渲染，供您即時進行狀態雙向開關切換。', { type: 'info' });
      return;
    }

    const tState = terminalStore.getState();
    const activePaneSessionKey = tState.activePaneSessionKey;

    if (!activePaneSessionKey || !tState.sessions[activePaneSessionKey]) {
      showToast('未建立活動連線，無法執行控制指令。請先點選雙擊 Hosts 卡片連線。', { type: 'error' });
      return;
    }

    const session = tState.sessions[activePaneSessionKey];
    if (session.isLocal || session.isLogView) {
      showToast(session.isLogView ? '歷史日誌回放分頁不支援控制面板。' : '本機終端分頁不適用控制面板。', { type: 'error' });
      return;
    }

    if (comp.type === 'info') {
      showToast('InfoBox 狀態組件為背景自動輪詢查詢，請直接在終端機側邊欄中查看狀態資訊。', { type: 'info' });
      return;
    }

    // 破壞性操作二次確認：執行前顯示即將執行的指令字串，讓使用者確認。
    // 註：localCommand 內若含 ${VAR}，最終值需待遠端輸出解析後才確定，此處顯示原始模板。
    const remoteCmd = String(comp.remoteCommand || '').trim();
    const localCmd = String(comp.localCommand || '').trim();
    const cmdLines = [];
    if (remoteCmd) cmdLines.push(`[遠端] ${remoteCmd}`);
    if (localCmd) cmdLines.push(`[本機] ${localCmd}`);
    if (cmdLines.length > 0) {
      if (!(await confirmDialog(`即將執行以下指令：\n\n${cmdLines.join('\n')}\n\n確定要執行嗎？`, { title: '確認執行指令', danger: true }))) {
        return;
      }
    }

    // 執行期間將卡片標記為 busy 並顯示 spinner，結束後恢復（參考 App.js SwitchBox 的 disable 做法）。
    const teardownBusy = this.setComponentCardBusy(card, true);
    try {
      const result = await executeFunctionBox(comp, activePaneSessionKey);
      if (!result.success) {
        const message = result.phase === 'remote'
          ? `SSH 指令執行失敗：${result.error || '未知錯誤'}`
          : result.phase === 'export'
            ? `變數解析失敗：${result.error || '未知錯誤'}`
            : `本機安全沙箱攔截或執行失敗：${result.error || '未知錯誤'}`;
        showToast(message, { type: 'error', title: 'FunctionBox 執行失敗' });
        return;
      }
      // 過長輸出不塞進 toast，僅顯示完成摘要（輸出已寫入既有日誌/終端）。
      showToast(`FunctionBox「${comp.name}」執行完成`, { type: 'success' });
    } catch (err) {
      showToast(`執行出錯: ${String(err)}`, { type: 'error', title: 'FunctionBox 執行失敗' });
    } finally {
      teardownBusy();
    }
  }

  // 將組件卡片切換為 busy 狀態：標記、降低互動性並注入 spinner；回傳一個還原函式。
  setComponentCardBusy(card, busy) {
    if (!card) return () => {};
    if (busy) {
      card.dataset.busy = '1';
      card.style.pointerEvents = 'none';
      card.style.opacity = '0.6';
      card.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (!card.querySelector('.component-card-spinner')) {
        const spinner = document.createElement('span');
        spinner.className = 'component-card-spinner';
        spinner.setAttribute('aria-label', '執行中');
        spinner.style.cssText = [
          'width: 14px',
          'height: 14px',
          'margin-left: 8px',
          'flex: 0 0 auto',
          'border: 2px solid var(--color-border)',
          'border-top-color: var(--color-primary)',
          'border-radius: 50%',
          'animation: spin 0.7s linear infinite'
        ].join(';');
        card.appendChild(spinner);
      }
    }
    return () => {
      delete card.dataset.busy;
      card.style.pointerEvents = '';
      card.style.opacity = '';
      card.querySelectorAll('button').forEach(b => { b.disabled = false; });
      const spinner = card.querySelector('.component-card-spinner');
      if (spinner) spinner.remove();
    };
  }
}

customElements.define('control-panel-page', ControlPanelPage);
