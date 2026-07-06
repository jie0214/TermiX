import { hostStore } from './HostStore';
import { HostAPI } from './HostAPI';
import { KeychainAPI } from './KeychainAPI';
import { terminalStore } from '../terminal/TerminalStore';
import { TerminalAPI } from '../terminal/TerminalAPI';
import { onWailsEvent } from '../../platform/wails/events.ts';
import { clearSessionLogs, deleteSessionLogs, LOGS_CHANGED_EVENT, readSessionLogs, sanitizeTerminalLogOutput } from '../terminal/SessionLogStore';
import { snippetStore } from '../snippets/SnippetStore';
import '../kubernetes/KubernetesPage';
import { pasteSnippetToSession, runSnippetInSession, runStartupCommand } from '../snippets/SnippetRuntime';
import { showToast } from '../../components/feedback/toast';
import { confirmDialog } from '../../components/feedback/confirmDialog';
import { t } from '../../i18n/index.ts';
import {
  DEFAULT_HOST_CONFIG,
  SECRET_FIELD_DEFINITIONS,
  createHostProfile,
  ensureSecretRefs,
  getSecretMask,
  getHostSecretStatusMap,
  getSecretStatusLabel
} from './HostVaultModel';

// 將後端 KeychainKey 的類型與位元組成顯示字串，例如 "Ed25519"、"RSA (3072)"。
function formatKeychainType(key) {
  const type = String(key.type || '').toLowerCase();
  if (type === 'ed25519') return 'Ed25519';
  if (type === 'ecdsa') return `ECDSA (${key.bits || 256})`;
  if (type === 'rsa') return `RSA (${key.bits || ''})`.trim();
  return key.type || '—';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function normalizeTerminalBootstrapOutput(output) {
  const sanitized = sanitizeTerminalLogOutput(output).trim();
  return sanitized ? `${sanitized}\n\n` : t('hostvault.connectSuccess');
}

function normalizeConnectionErrorMessage(errorMessage) {
  const rawMessage = String(errorMessage || '');
  const sanitized = sanitizeTerminalLogOutput(rawMessage).trim();
  const isLeakingSudoProbe =
    /sudo shell 啟動失敗/.test(rawMessage) &&
    /(?:whoami\s*=|printf\s+['"]\\n__TERMIX_DONE_\d+__:%s\\n['"]\s+["']?\$status["']?|__TERMIX_DONE_\d+__)/.test(rawMessage);

  if (isLeakingSudoProbe) {
    return t('hostvault.sudoShellFailed');
  }

  // 後端回傳的常見中文連線錯誤 → 對應 i18n（後端維持不變）。
  if (rawMessage.includes('連線已被使用者取消')) {
    return t('hostvault.connCancelledByUser');
  }
  if (rawMessage.includes('連線已中斷')) {
    return t('hostvault.connLostReconnect');
  }

  return sanitized || t('hostvault.unknownError');
}

function formatSnippetPackageName(packageId, packages) {
  if (!packageId) return 'Unpackaged';
  return packages.find(pkg => pkg.id === packageId)?.name || 'Unpackaged';
}

function isValidControlPanelComponent(comp) {
  return comp && comp.id && ['info', 'switch', 'function'].includes(comp.type);
}

function getAvailableControlPanelComponents() {
  try {
    const rawComps = localStorage.getItem('termix-custom-components');
    const comps = rawComps ? JSON.parse(rawComps) : [];
    return Array.isArray(comps) ? comps.filter(isValidControlPanelComponent) : [];
  } catch (e) {
    return [];
  }
}

function normalizeMountedComponents(customComponents, availableComps) {
  const availableIds = new Set(availableComps.map(comp => comp.id));
  return (Array.isArray(customComponents) ? customComponents : [])
    .filter(item => item && item.id && availableIds.has(item.id) && item.visible)
    .map((item, idx) => ({ id: item.id, visible: true, order: item.order ?? idx }))
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
    .map((item, idx) => ({ ...item, order: idx }));
}

function collectMountedComponents(root, previousComponents, availableComps) {
  const previousOrder = new Map(normalizeMountedComponents(previousComponents, availableComps).map((item, idx) => [item.id, item.order ?? idx]));
  return Array.from(root.querySelectorAll('.comp-checkbox'))
    .filter(cb => cb.checked)
    .map((cb, idx) => {
      const id = cb.getAttribute('data-comp-id');
      return { id, visible: true, order: previousOrder.has(id) ? previousOrder.get(id) : idx + previousOrder.size };
    })
    .filter(item => item.id)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
    .map((item, idx) => ({ ...item, order: idx }));
}

function getStartupCommandDefaults(config = {}) {
  const legacyStartupSnippetId = Array.isArray(config.startupSnippetIds) ? config.startupSnippetIds[0] : '';
  const startupSnippetId = config.startupSnippetId || legacyStartupSnippetId || '';
  const startupCommandMode = config.startupCommandMode || (startupSnippetId ? 'snippet' : (config.startupCommandText ? 'manual' : 'none'));
  return {
    startupCommandMode,
    startupSnippetId,
    startupCommandText: config.startupCommandText || ''
  };
}

function readStartupCommandConfig(root, previousConfig = {}) {
  const defaults = getStartupCommandDefaults(previousConfig);
  const startupCommandMode = root.querySelector('#startupCommandMode')?.value || defaults.startupCommandMode;
  const startupSnippetId = root.querySelector('#startupSnippetSelect')?.value || '';
  const startupCommandText = root.querySelector('#startupCommandText')?.value || '';
  return {
    startupCommandMode,
    startupSnippetId,
    startupCommandText,
    startupSnippetIds: startupSnippetId ? [startupSnippetId] : []
  };
}

function createDraftHostId() {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function renderSecretStatusBadge(field, drawerHost) {
  const statusMap = getHostSecretStatusMap(drawerHost);
  const status = statusMap[field.key] || { status: 'unset' };
  const statusValue = typeof status === 'object' && status ? status.status : status;
  return `
    <div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px; margin-top: 6px;">
      <span id="${field.statusId}" data-initial-status="${statusValue || 'unset'}" style="font-size: 11px; color: var(--color-text-muted);">${getSecretStatusLabel(status)}</span>
      <input type="hidden" id="${field.actionInputId}" value="keep">
    </div>
  `;
}

function renderSecretInputState(field, drawerHost) {
  const status = getHostSecretStatusMap(drawerHost)[field.key] || { status: 'unset' };
  const mask = getSecretMask(status);
  if (!mask) {
    return 'value="" data-secret-pristine="false"';
  }
  return `value="${mask}" data-secret-mask="${mask}" data-secret-pristine="true"`;
}

function renderSecretInput(field, drawerHost, extraAttrs = '') {
  const hostId = drawerHost?.id || '';
  return `
    <div style="display: flex; align-items: center; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); border-radius: 6px; overflow: hidden;">
      <input class="no-drag" id="${field.inputId}" name="${field.inputId}" type="password" data-host-id="${hostId}" data-secret-field="${field.key}" ${renderSecretInputState(field, drawerHost)} ${extraAttrs} style="flex: 1; min-width: 0; background: transparent; border: none; padding: 8px 10px 8px 12px; color: var(--color-text); outline: none;">
      <button type="button" class="no-drag secret-visibility-toggle" data-target="${field.inputId}" title="${t('hostvault.showPassword')}" aria-label="${t('hostvault.showPassword')}" style="width: 34px; align-self: stretch; border: none; border-left: 1px solid rgba(23,107,135,0.18); background: transparent; color: var(--color-subtext); cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
  `;
}

function bindSecretFieldState(root) {
  SECRET_FIELD_DEFINITIONS.forEach((field) => {
    const input = root.querySelector(`#${field.inputId}`);
    const actionInput = root.querySelector(`#${field.actionInputId}`);
    const statusEl = root.querySelector(`#${field.statusId}`);
    if (!input || !actionInput || !statusEl) return;

    const initialStatus = statusEl.dataset.initialStatus || 'unset';
    const setStatus = (status, action = 'keep') => {
      actionInput.value = action;
      statusEl.textContent = getSecretStatusLabel(status);
    };
    input.addEventListener('input', () => {
      if (input.dataset.secretPristine === 'true') {
        if (input.value === input.dataset.secretMask) {
          setStatus(initialStatus === 'stored' ? 'stored' : 'unset', 'keep');
          return;
        }
        input.dataset.secretPristine = 'false';
      }
      if (input.value) {
        setStatus('updated', 'set');
      } else if (initialStatus === 'stored') {
        setStatus('cleared', 'clear');
      } else {
        setStatus('unset', 'keep');
      }
    });
  });
}

function bindSecretVisibilityToggles(root) {
  root.querySelectorAll('.secret-visibility-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const input = root.querySelector(`#${btn.getAttribute('data-target')}`);
      if (!input) return;
      const nextType = input.type === 'password' ? 'text' : 'password';
      if (nextType === 'text' && input.dataset.secretPristine === 'true' && input.dataset.secretMask) {
        const hostId = input.dataset.hostId || '';
        const field = input.dataset.secretField || '';
        if (!input.dataset.secretRevealValue && hostId && field) {
          try {
            const secret = await HostAPI.getHostSecretValue(hostId, field);
            if (secret?.found) {
              input.dataset.secretRevealValue = secret.value || '';
            } else {
              showToast(t('hostvault.readSecretNotFound'), { type: 'error' });
              return;
            }
          } catch (error) {
            showToast(t('hostvault.readSecretFailed', { error: error.message || error }), { type: 'error' });
            return;
          }
        }
        if (input.dataset.secretRevealValue !== undefined) {
          input.value = input.dataset.secretRevealValue;
        }
      }
      if (nextType === 'password' && input.dataset.secretPristine === 'true' && input.dataset.secretMask) {
        input.value = input.dataset.secretMask;
      }
      input.type = nextType;
      const label = nextType === 'password' ? t('hostvault.showPassword') : t('hostvault.hidePassword');
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
      btn.style.color = nextType === 'password' ? 'var(--color-subtext)' : 'var(--color-primary)';
    });
  });
}

function buildSecretsPayload(root, hostId, existingHost) {
  const refs = ensureSecretRefs(hostId, existingHost?.config || {});
  return SECRET_FIELD_DEFINITIONS.reduce((acc, field) => {
    const action = root.querySelector(`#${field.actionInputId}`)?.value || 'keep';
    const input = root.querySelector(`#${field.inputId}`);
    const isPristineMask = input?.dataset.secretPristine === 'true';
    const value = isPristineMask ? '' : (input?.value || '');
    const ref = refs[field.refKey];

    if (action === 'clear') {
      acc[field.key] = { action: 'clear', ref, clear: true, hasValue: false };
      return acc;
    }

    if (value) {
      acc[field.key] = { action: 'set', value, ref, hasValue: true, clear: false };
      return acc;
    }

    if (ref) {
      acc[field.key] = { action: 'preserve', ref, hasValue: false, clear: false };
    }
    return acc;
  }, {});
}

function findMatchingSavedHost(hosts, query) {
  const normalizedQuery = (query || '').trim().toLowerCase();
  if (!normalizedQuery) return null;
  return hosts.find((host) => {
    const alias = (host.alias || '').toLowerCase();
    const label = (host.label || '').toLowerCase();
    const hostName = (host.config?.host || '').toLowerCase();
    const composite = `${host.config?.username || ''}@${host.config?.host || ''}`.toLowerCase();
    return [alias, label, hostName, composite].includes(normalizedQuery);
  }) || null;
}

function promptExportMode() {
  return showChoiceDialog({
    title: t('hostvault.exportModeTitle'),
    options: [
      { value: 'reference', label: 'Reference' },
      { value: 'safe', label: 'Safe' },
      { value: 'full', label: 'Full' }
    ]
  });
}

function promptImportMode() {
  return showChoiceDialog({
    title: t('hostvault.importModeTitle'),
    options: [
      { value: 'reference-only', label: 'Reference Only' },
      { value: 'config-only', label: 'Config Only' },
      { value: 'reference+secret', label: 'Reference + Secret' }
    ]
  });
}

function showChoiceDialog({ title, options }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay no-drag';
    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(12, 18, 31, 0.72); display: flex; align-items: center; justify-content: center; z-index: 100000; backdrop-filter: blur(4px);';
    overlay.innerHTML = `
      <div class="settings-dialog no-drag" style="width: min(360px, calc(100vw - 32px)); background: var(--glass-bg-strong); border: 1px solid var(--glass-border); border-radius: 8px; box-shadow: var(--glass-shadow);">
        <div class="settings-header" style="padding: 16px 18px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; align-items: center; justify-content: space-between;">
          <h2 style="font-size: 14px; font-weight: 800; color: var(--color-text); margin: 0;">${escapeHtml(title)}</h2>
          <button type="button" aria-label="${t('common.close')}" class="no-drag choice-cancel-btn icon-btn" style="font-size: 18px; line-height: 1;">&times;</button>
        </div>
        <div style="padding: 14px; display: grid; gap: 8px;">
          ${options.map(option => `
            <button type="button" class="no-drag choice-option-btn" data-value="${escapeHtml(option.value)}" style="min-height: 36px; border: 1px solid rgba(23,107,135,0.22); border-radius: 6px; background: rgba(255,255,255,0.04); color: var(--color-text); font-weight: 700; cursor: pointer; text-align: left; padding: 0 12px;">
              ${escapeHtml(option.label)}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    const close = (value = '') => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('.choice-cancel-btn')) {
        close('');
        return;
      }
      const option = event.target.closest('.choice-option-btn');
      if (option) {
        close(option.getAttribute('data-value') || '');
      }
    });

    document.body.appendChild(overlay);
  });
}

// 產生 / 匯入 SSH 金鑰的對話框；resolve 表單資料，取消則 resolve(null)。
function openKeychainKeyDialog(mode) {
  const isImport = mode === 'import';
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay no-drag';
    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(12, 18, 31, 0.72); display: flex; align-items: center; justify-content: center; z-index: 100000; backdrop-filter: blur(4px);';

    const fieldStyle = 'width: 100%; min-height: 34px; box-sizing: border-box; padding: 0 10px; background: rgba(12,18,31,0.6); border: 1px solid rgba(23,107,135,0.3); border-radius: 6px; color: var(--color-text); font-size: 13px;';
    const labelStyle = 'display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--color-text-muted); margin-bottom: 5px;';

    const bodyHtml = isImport ? `
      <label style="${labelStyle}">${escapeHtml(t('hostvault.keychainLabel'))}</label>
      <input type="text" id="kcLabel" class="no-drag" style="${fieldStyle}" placeholder="my-imported-key" />
      <label style="${labelStyle} margin-top: 12px;">${escapeHtml(t('hostvault.keychainPrivateKey'))}</label>
      <textarea id="kcPrivateKey" class="no-drag" rows="7" style="${fieldStyle} min-height: 130px; padding: 8px 10px; font-family: monospace; resize: vertical;" placeholder="${escapeHtml(t('hostvault.keychainPrivateKeyPlaceholder'))}"></textarea>
      <label style="${labelStyle} margin-top: 12px;">${escapeHtml(t('hostvault.keychainImportPassphrase'))}</label>
      <input type="password" id="kcPassphrase" class="no-drag" style="${fieldStyle}" autocomplete="off" />
      <label style="${labelStyle} margin-top: 12px;">${escapeHtml(t('hostvault.keychainComment'))}</label>
      <input type="text" id="kcComment" class="no-drag" style="${fieldStyle}" />
    ` : `
      <label style="${labelStyle}">${escapeHtml(t('hostvault.keychainLabel'))}</label>
      <input type="text" id="kcLabel" class="no-drag" style="${fieldStyle}" placeholder="my-new-key" />
      <div style="display: flex; gap: 10px; margin-top: 12px;">
        <div style="flex: 1;">
          <label style="${labelStyle}">${escapeHtml(t('hostvault.keychainType'))}</label>
          <select id="kcType" class="no-drag" style="${fieldStyle}">
            <option value="ed25519">Ed25519</option>
            <option value="ecdsa">ECDSA</option>
            <option value="rsa">RSA</option>
            <option value="mldsa" disabled>ML-DSA (${escapeHtml(t('hostvault.keychainMldsaDisabled'))})</option>
          </select>
        </div>
        <div style="flex: 1;">
          <label style="${labelStyle}">${escapeHtml(t('hostvault.keychainStrength'))}</label>
          <select id="kcBits" class="no-drag" style="${fieldStyle}"></select>
        </div>
      </div>
      <label style="${labelStyle} margin-top: 12px;">${escapeHtml(t('hostvault.keychainPassphrase'))}</label>
      <input type="password" id="kcPassphrase" class="no-drag" style="${fieldStyle}" autocomplete="off" />
      <label style="${labelStyle} margin-top: 12px;">${escapeHtml(t('hostvault.keychainComment'))}</label>
      <input type="text" id="kcComment" class="no-drag" style="${fieldStyle}" />
    `;

    const title = isImport ? t('hostvault.keychainDialogImportTitle') : t('hostvault.keychainDialogGenerateTitle');
    const submitLabel = isImport ? t('hostvault.keychainImport') : t('hostvault.keychainGenerate');

    overlay.innerHTML = `
      <div class="settings-dialog no-drag" style="width: min(440px, calc(100vw - 32px)); background: var(--glass-bg-strong); border: 1px solid var(--glass-border); border-radius: 8px; box-shadow: var(--glass-shadow);">
        <div class="settings-header" style="padding: 16px 18px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; align-items: center; justify-content: space-between;">
          <h2 style="font-size: 14px; font-weight: 800; color: var(--color-text); margin: 0;">${escapeHtml(title)}</h2>
          <button type="button" aria-label="${t('common.close')}" class="no-drag kc-cancel-btn icon-btn" style="font-size: 18px; line-height: 1;">&times;</button>
        </div>
        <div style="padding: 16px 18px; max-height: 70vh; overflow-y: auto;">
          ${bodyHtml}
        </div>
        <div class="settings-footer" style="padding: 14px 18px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 8px; justify-content: flex-end;">
          <button type="button" class="no-drag kc-cancel-btn" style="min-height: 34px; padding: 0 14px; border: 1px solid rgba(23,107,135,0.3); background: transparent; color: var(--color-text); border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;">${escapeHtml(t('common.cancel'))}</button>
          <button type="button" class="no-drag primary kc-submit-btn" style="min-height: 34px; padding: 0 16px; border: none; background: var(--color-primary); color: #fff; border-radius: 6px; font-size: 12px; font-weight: 800; cursor: pointer;">${escapeHtml(submitLabel)}</button>
        </div>
      </div>
    `;

    const close = (value) => { overlay.remove(); resolve(value); };

    if (!isImport) {
      const typeSel = overlay.querySelector('#kcType');
      const bitsSel = overlay.querySelector('#kcBits');
      const populateBits = () => {
        const type = typeSel.value;
        let opts;
        if (type === 'rsa') opts = [['2048', '2048'], ['3072', '3072'], ['4096', '4096']];
        else if (type === 'ecdsa') opts = [['256', 'P-256'], ['384', 'P-384'], ['521', 'P-521']];
        else opts = [['0', '—']];
        bitsSel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
        bitsSel.disabled = type === 'ed25519';
        if (type === 'rsa') bitsSel.value = '3072';
      };
      typeSel.addEventListener('change', populateBits);
      populateBits();
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('.kc-cancel-btn')) {
        close(null);
      }
    });

    overlay.querySelector('.kc-submit-btn').addEventListener('click', () => {
      const labelEl = overlay.querySelector('#kcLabel');
      const label = labelEl.value.trim();
      if (!label) { labelEl.focus(); return; }
      const comment = overlay.querySelector('#kcComment').value.trim();
      const passphrase = overlay.querySelector('#kcPassphrase').value;
      if (isImport) {
        const pkEl = overlay.querySelector('#kcPrivateKey');
        const privateKey = pkEl.value.trim();
        if (!privateKey) { pkEl.focus(); return; }
        close({ mode: 'import', label, privateKey, passphrase, comment });
      } else {
        const type = overlay.querySelector('#kcType').value;
        const bits = parseInt(overlay.querySelector('#kcBits').value, 10) || 0;
        close({ mode: 'generate', label, type, bits, passphrase, comment });
      }
    });

    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#kcLabel')?.focus(), 0);
  });
}

export class HostListPage extends HTMLElement {
  constructor() {
    super();
    this.unsubscribe = null;
    // 視圖狀態指紋；用於避免無關 store 變更觸發整頁 innerHTML 重建（H2）。
    this.lastViewFingerprint = null;
    this.currentBatchTargetGroupId = null;
    this.batchTargetsSearchQuery = "";
    this.batchTargetsSearchFocused = false;
    this.activePackageId = 'all';
    this.showAllSnippets = false;
    this.snippetDrawerMode = 'snippet';
    this.selectedPackage = null;
    this.selectedAWSIntegration = null;
    this.awsSyncSettingsExpanded = false;
    // Keychain 分頁資料由後端載入（私鑰存 OS Keychain，中繼資料存 SQLite）。
    this.keychainKeys = [];
    this.keychainLoaded = false;
    this.keychainLoading = false;
    // Known Hosts 分頁資料由後端讀取 ~/.ssh/known_hosts 取得。
    this.knownHosts = [];
    this.knownHostsLoaded = false;
    this.knownHostsLoading = false;
    this.handleLogsChanged = () => {
      if (hostStore.getState().selectedTab === 'logs') {
        this.render();
        this.setupListeners();
      }
    };
  }

  connectedCallback() {
    const state = hostStore.getState();
    if (state.hosts.length === 0 && state.groups.length === 0) {
      state.loadFromBackend().catch((e) => {
        console.error('[TermiX] HostVault 載入失敗', e);
      });
    }
    if (snippetStore.getState().snippets.length === 0) {
      snippetStore.getState().loadSnippets();
    }
    // 預先載入 Keychain 金鑰，供 Host 表單的金鑰選單使用。
    this.loadKeychainKeys();
    this.render();
    this.setupListeners();
    this.setupGlobalDelegation();
    // 初始渲染後建立指紋基準，供後續訂閱比對。
    this.lastViewFingerprint = this.getViewFingerprint();
    window.addEventListener(LOGS_CHANGED_EVENT, this.handleLogsChanged);

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.unsubscribe = hostStore.subscribe(() => {
      this.renderIfChanged();
    });

    if (this.unsubscribeSnippet) {
      this.unsubscribeSnippet();
      this.unsubscribeSnippet = null;
    }
    this.unsubscribeSnippet = snippetStore.subscribe(() => {
      this.renderIfChanged();
    });
  }

  // 訂閱回呼共用入口：僅在視圖指紋實際改變時才整頁重建並重綁事件（H2）。
  // 指紋未變時直接跳過，避免輸入框失焦、捲動重置與無謂的事件重綁。
  renderIfChanged() {
    const currentFingerprint = this.getViewFingerprint();
    if (currentFingerprint === this.lastViewFingerprint) return;
    // render() 內部會在結尾重新計算並更新 this.lastViewFingerprint。
    this.render();
    this.setupListeners();
  }

  // 從後端載入 Keychain 金鑰清單並在完成後重繪分頁。
  async loadKeychainKeys(force = false) {
    if (this.keychainLoading) return;
    if (this.keychainLoaded && !force) return;
    this.keychainLoading = true;
    try {
      const keys = await KeychainAPI.list();
      this.keychainKeys = Array.isArray(keys) ? keys : [];
      this.keychainLoaded = true;
    } catch (err) {
      showToast(t('hostvault.keychainLoadFailed', { error: err.message || err }), { type: 'error' });
    } finally {
      this.keychainLoading = false;
    }
    const st = hostStore.getState();
    if (st.selectedTab === 'keychain' || st.drawerOpen) {
      this.render();
      this.setupListeners();
    }
  }

  // 從後端讀取 known_hosts 清單並在完成後重繪分頁。
  async loadKnownHosts(force = false) {
    if (this.knownHostsLoading) return;
    if (this.knownHostsLoaded && !force) return;
    this.knownHostsLoading = true;
    try {
      const hosts = await HostAPI.listKnownHosts();
      this.knownHosts = Array.isArray(hosts) ? hosts : [];
      this.knownHostsLoaded = true;
    } catch (err) {
      showToast(t('hostvault.knownHostsLoadFailed', { error: err.message || err }), { type: 'error' });
    } finally {
      this.knownHostsLoading = false;
    }
    if (hostStore.getState().selectedTab === 'known_hosts') {
      this.render();
      this.setupListeners();
    }
  }

  // 開啟產生 / 匯入對話框並呼叫後端建立金鑰。
  async handleKeychainCreate(mode) {
    const form = await openKeychainKeyDialog(mode);
    if (!form) return;
    try {
      if (form.mode === 'import') {
        const key = await KeychainAPI.importKey({
          label: form.label,
          privateKey: form.privateKey,
          passphrase: form.passphrase,
          comment: form.comment
        });
        showToast(t('hostvault.keychainImported', { label: key.label }), { type: 'success' });
      } else {
        const key = await KeychainAPI.generate({
          label: form.label,
          type: form.type,
          bits: form.bits,
          passphrase: form.passphrase,
          comment: form.comment
        });
        showToast(t('hostvault.keychainGenerated', { label: key.label }), { type: 'success' });
      }
      this.loadKeychainKeys(true);
    } catch (err) {
      showToast(t('hostvault.keychainSaveFailed', { error: err.message || err }), { type: 'error' });
    }
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.unsubscribeSnippet) this.unsubscribeSnippet();
    window.removeEventListener(LOGS_CHANGED_EVENT, this.handleLogsChanged);
  }

  buildBatchTargetsHtml(state, selectedTargetIds) {
    // 1. 全局搜尋結果視圖
    if (this.batchTargetsSearchQuery) {
      const q = this.batchTargetsSearchQuery.toLowerCase();
      const filteredHosts = state.hosts.filter(h =>
        (h.alias || h.label || '').toLowerCase().includes(q) ||
        (h.config?.host || '').toLowerCase().includes(q)
      );

      if (filteredHosts.length === 0) {
        return `<div style="padding: 12px; text-align: center; color: var(--color-text-muted); font-size: 12px;">${t('hostvault.noMatchingHosts')}</div>`;
      }

      let html = "";
      filteredHosts.forEach(host => {
        const isChecked = selectedTargetIds.has(host.id);
        html += `
          <div class="batch-host-row" style="display: flex; align-items: center; border-bottom: 1px solid rgba(23, 107, 135, 0.1); padding: 8px 12px; margin-bottom: 4px; border-radius: 4px; transition: background 0.2s;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text); cursor: pointer; width: 100%; user-select: none;">
              <input type="checkbox" class="no-drag snippet-target-checkbox" data-host-id="${host.id}" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; accent-color: var(--color-primary); flex-shrink: 0;">
              <span style="font-weight: 700; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 150px;">${escapeHtml(host.alias || host.label || 'Host')}</span>
              <span style="color: var(--color-text-muted); font-family: monospace; font-size: 11.5px; margin-left: auto;">(${escapeHtml(host.config?.host || '')})</span>
            </label>
          </div>
        `;
      });
      return html;
    }

    // 2. 群組清單視圖
    if (this.currentBatchTargetGroupId === null) {
      let html = "";

      // 渲染所有已定義群組
      state.groups.forEach(group => {
        const groupHosts = state.hosts.filter(h => h.groupId === group.id);
        const hasHosts = groupHosts.length > 0;
        const allChecked = hasHosts && groupHosts.every(h => selectedTargetIds.has(h.id));
        const partialChecked = hasHosts && !allChecked && groupHosts.some(h => selectedTargetIds.has(h.id));

        html += `
          <div class="batch-group-row" data-group-id="${group.id}" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(23, 107, 135, 0.12); padding: 8px 12px; margin-bottom: 4px; border-radius: 4px; cursor: pointer; transition: background 0.2s; user-select: none;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text); cursor: pointer; flex: 1; min-width: 0; user-select: none;">
              <input type="checkbox" class="no-drag snippet-group-checkbox" data-group-id="${group.id}" ${allChecked ? 'checked' : ''} ${partialChecked ? 'data-indeterminate="true"' : ''} style="width: 14px; height: 14px; accent-color: var(--color-primary);">
              <span style="font-weight: 700; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(group.name)}</span>
              <span style="color: var(--color-text-muted); font-size: 11px;">(${groupHosts.length} hosts)</span>
            </label>
            <span style="color: var(--color-primary); font-size: 12px; font-weight: 800; padding-right: 4px;">&gt;</span>
          </div>
        `;
      });

      // 渲染未分類主機（Ungrouped）
      const ungroupedHosts = state.hosts.filter(h => !h.groupId);
      const hasUngrouped = ungroupedHosts.length > 0;
      const ungroupedAllChecked = hasUngrouped && ungroupedHosts.every(h => selectedTargetIds.has(h.id));
      const ungroupedPartialChecked = hasUngrouped && !ungroupedAllChecked && ungroupedHosts.some(h => selectedTargetIds.has(h.id));

      html += `
        <div class="batch-group-row" data-group-id="ungrouped" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(23, 107, 135, 0.12); padding: 8px 12px; margin-bottom: 4px; border-radius: 4px; cursor: pointer; transition: background 0.2s; user-select: none;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text); cursor: pointer; flex: 1; min-width: 0; user-select: none;">
            <input type="checkbox" class="no-drag snippet-group-checkbox" data-group-id="ungrouped" ${ungroupedAllChecked ? 'checked' : ''} ${ungroupedPartialChecked ? 'data-indeterminate="true"' : ''} style="width: 14px; height: 14px; accent-color: var(--color-primary);">
            <span style="font-weight: 700; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">Ungrouped</span>
            <span style="color: var(--color-text-muted); font-size: 11px;">(${ungroupedHosts.length} hosts)</span>
          </label>
          <span style="color: var(--color-primary); font-size: 12px; font-weight: 800; padding-right: 4px;">&gt;</span>
        </div>
      `;

      return html;
    }

    // 3. 進入特定群組的主機清單視圖
    const groupId = this.currentBatchTargetGroupId;
    const isUngrouped = groupId === 'ungrouped';
    const groupName = isUngrouped
      ? 'Ungrouped'
      : (state.groups.find(g => g.id === groupId)?.name || 'Unknown Group');

    const groupHosts = isUngrouped
      ? state.hosts.filter(h => !h.groupId)
      : state.hosts.filter(h => h.groupId === groupId);

    let hostsHtml = "";
    if (groupHosts.length === 0) {
      hostsHtml = `<div style="padding: 12px; text-align: center; color: var(--color-text-muted); font-size: 12px;">${t('hostvault.groupNoHosts')}</div>`;
    } else {
      groupHosts.forEach(host => {
        const isChecked = selectedTargetIds.has(host.id);
        hostsHtml += `
          <div class="batch-host-row" style="display: flex; align-items: center; border-bottom: 1px solid rgba(23, 107, 135, 0.1); padding: 8px 12px; margin-bottom: 4px; border-radius: 4px; transition: background 0.2s;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text); cursor: pointer; width: 100%; user-select: none;">
              <input type="checkbox" class="no-drag snippet-target-checkbox" data-host-id="${host.id}" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px; accent-color: var(--color-primary); flex-shrink: 0;">
              <span style="font-weight: 700; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 150px;">${escapeHtml(host.alias || host.label || 'Host')}</span>
              <span style="color: var(--color-text-muted); font-family: monospace; font-size: 11.5px; margin-left: auto;">(${escapeHtml(host.config?.host || '')})</span>
            </label>
          </div>
        `;
      });
    }

    return `
      <div style="display: flex; flex-direction: column; height: 100%; min-height: 0;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(23,107,135,0.15); padding-bottom: 8px; flex-shrink: 0;">
          <button type="button" id="backToGroupListBtn" class="no-drag" style="background: transparent; border: 1px solid rgba(23,107,135,0.25); border-radius: 4px; padding: 6px 12px; color: var(--color-text); cursor: pointer; font-size: 11px; font-weight: 800; transition: all 0.2s;">&lt; Back</button>
          <span style="font-size: 12.5px; font-weight: 700; color: var(--color-text); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(groupName)}</span>
        </div>
        <div style="flex: 1; overflow-y: auto;">
          ${hostsHtml}
        </div>
      </div>
    `;
  }

  openAWSIntegrationDrawer(integration = null, options = {}) {
    const { selectedTab = 'integrations', closeDropdowns = false } = options;
    this.selectedAWSIntegration = integration;
    this.awsSyncSettingsExpanded = Boolean(integration);
    this.selectedGroup = null;
    hostStore.getState().setSelectedHost(null);
    hostStore.getState().setSelectedTab(selectedTab);
    hostStore.getState().setDrawerMode('aws-integration');
    hostStore.getState().setDrawerOpen(true);

    if (closeDropdowns) {
      this.querySelectorAll('.termix-dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
    }
  }

  resolveSelectedAWSIntegration() {
    const state = hostStore.getState();
    const selectedGroupId = String(this.selectedAWSIntegration?.groupId || '').trim();
    if (!selectedGroupId) {
      return null;
    }
    return (state.awsIntegrations || []).find(item => item.groupId === selectedGroupId) || null;
  }

  renderIntegrationsPage(state) {
    const integrations = state.awsIntegrations || [];
    const integrationCardsHtml = integrations.map((integration) => {
      const relatedGroup = state.groups.find(group => group.id === integration.groupId);
      const integrationName = integration.name || relatedGroup?.name || 'AWS Integration';
      const groupName = relatedGroup?.name || integration.groupId || t('hostvault.integrationNoGroup');
      const sourceLabel = integration.importSource === 'lightsail'
        ? 'Lightsail'
        : integration.importSource === 'ec2'
          ? 'EC2'
          : 'EC2 / Lightsail';
      const ipTypeLabel = integration.ipAddressType === 'private'
        ? 'Private IP'
        : integration.ipAddressType === 'public'
          ? 'Public IP'
          : 'Public / Private IP';

      return `
        <div class="vault-card integration-card no-drag" data-integration-group-id="${integration.groupId}" title="${t('hostvault.editIntegrationTitle', { name: escapeHtml(integrationName) })}">
          <div class="vault-card-icon" style="background: linear-gradient(135deg, #ff9900, #f97316); border-radius: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          </div>
          <div class="vault-card-info">
            <div class="vault-card-title">${escapeHtml(integrationName)}</div>
            <div class="vault-card-details">${escapeHtml(groupName)}，${escapeHtml(integration.region || t('hostvault.integrationNoRegion'))}</div>
            <div class="vault-card-details" style="margin-top: 4px; color: var(--color-text-muted);">${escapeHtml(sourceLabel)}，${escapeHtml(ipTypeLabel)}</div>
          </div>
          <button type="button" aria-label="${t('hostvault.editIntegration')}" class="no-drag vault-integration-edit-btn" data-integration-group-id="${integration.groupId}" title="${t('hostvault.editIntegration')}" style="background: transparent; border: none; padding: 6px; cursor: pointer; color: var(--color-subtext); display: inline-flex; align-items: center; justify-content: center; margin-left: auto;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 12px; flex: 0 0 auto;">
        <div style="display: flex; flex-direction: column; gap: 4px; text-align: left;">
          <div style="font-size: 14px; font-weight: 700; color: var(--color-text);">Integrations</div>
          <div style="font-size: 12px; color: var(--color-text-muted);">${t('hostvault.integrationsDesc')}</div>
        </div>
        <button type="button" id="newIntegrationBtn" class="no-drag primary" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: var(--color-primary); border: none; border-radius: 4px; color: #fff; cursor: pointer;">+ NEW INTEGRATION</button>
      </div>

      <div class="vault-scroll-content" style="flex: 1; min-height: 0; overflow-y: auto;">
        <div class="vault-section">
          <h3 style="font-size: 14px; font-weight: 700; color: var(--color-text-muted); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">Cloud Integrations</h3>
          <div id="vaultIntegrationsGrid" class="vault-grid">${integrationCardsHtml || `<div style="color: var(--color-text-muted); font-size: 13px;">${t('hostvault.noIntegrations')}</div>`}</div>
        </div>
      </div>
    `;
  }

  renderAWSIntegrationForm() {
    const state = hostStore.getState();
    const currentIntegration = this.resolveSelectedAWSIntegration();
    const relatedGroup = currentIntegration
      ? state.groups.find(group => group.id === currentIntegration.groupId)
      : null;
    const secretPlaceholder = currentIntegration
      ? t('hostvault.awsSecretKeep')
      : t('hostvault.awsSecretAccessKey');
    const isExpanded = this.awsSyncSettingsExpanded || false;
    const expandedStyle = `flex-direction: column; gap: 16px; margin-top: 12px; padding: 16px; background: rgba(23, 107, 135, 0.04); border: 1px solid rgba(23, 107, 135, 0.12); border-radius: 8px; ${isExpanded ? 'display: flex;' : 'display: none;'}`;
    const authMode = currentIntegration?.authMode || 'password';
    const showPasswordStyle = `flex-direction: column; gap: 16px; ${authMode === 'password' ? 'display: flex;' : 'display: none;'}`;
    const showKeyStyle = `flex-direction: column; gap: 16px; ${authMode === 'key' ? 'display: flex;' : 'display: none;'}`;


    return `
      <div class="settings-dialog" style="width: 100% !important; height: 100% !important; max-height: 100% !important; border: none !important; box-shadow: none !important; transform: none !important; display: flex; flex-direction: column;">
        <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="font-size: 15px; font-weight: 700; color: var(--color-text); font-family: inherit;">AWS Integration</h2>
          <button type="button" aria-label="${t('hostvault.closeSettings')}" id="closeVaultDrawer" class="no-drag btn-icon icon-btn" title="${t('hostvault.closeSettings')}" style="font-size: 18px;">
            &times;
          </button>
        </div>

        <form id="awsIntegrationForm" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; margin: 0;">
          <input type="hidden" id="awsCurrentGroupId" value="${escapeHtml(currentIntegration?.groupId || '')}">
          <div class="settings-body" style="padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
            <div class="section-title" style="margin-bottom: 4px;">
              <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${t('hostvault.awsSettingsTitle')}</h3>
            </div>

            <!-- 物件名稱 Label -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.objectName')}
              <input class="no-drag" id="awsIntegrationName" name="awsIntegrationName" value="${escapeHtml(currentIntegration?.name || '')}" placeholder="${t('hostvault.objectNamePlaceholder')}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-weight: 600;">
            </label>

            <!-- 群組名稱 Label -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.groupName')}
              <input class="no-drag" id="awsGroupName" name="awsGroupName" list="existingGroupsList" value="${escapeHtml(relatedGroup?.name || '')}" placeholder="${t('hostvault.groupNamePlaceholder')}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-weight: 600;">
              <datalist id="existingGroupsList">
                ${(state.groups || []).map(g => `<option value="${escapeHtml(g.name)}"></option>`).join('')}
              </datalist>
            </label>

            <!-- Region 區域選擇 -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.regionSelect')}
              <select class="no-drag" id="awsRegion" name="awsRegion" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                <option value="ap-northeast-1" ${currentIntegration?.region === 'ap-northeast-1' ? 'selected' : ''}>${t('hostvault.regionTokyo')}</option>
                <option value="ap-northeast-2" ${currentIntegration?.region === 'ap-northeast-2' ? 'selected' : ''}>${t('hostvault.regionSeoul')}</option>
                <option value="ap-northeast-3" ${currentIntegration?.region === 'ap-northeast-3' ? 'selected' : ''}>${t('hostvault.regionOsaka')}</option>
                <option value="ap-southeast-1" ${currentIntegration?.region === 'ap-southeast-1' ? 'selected' : ''}>${t('hostvault.regionSingapore')}</option>
                <option value="ap-southeast-2" ${currentIntegration?.region === 'ap-southeast-2' ? 'selected' : ''}>${t('hostvault.regionSydney')}</option>
                <option value="us-east-1" ${currentIntegration?.region === 'us-east-1' ? 'selected' : ''}>${t('hostvault.regionVirginia')}</option>
                <option value="us-east-2" ${currentIntegration?.region === 'us-east-2' ? 'selected' : ''}>${t('hostvault.regionOhio')}</option>
                <option value="us-west-1" ${currentIntegration?.region === 'us-west-1' ? 'selected' : ''}>${t('hostvault.regionCalifornia')}</option>
                <option value="us-west-2" ${currentIntegration?.region === 'us-west-2' ? 'selected' : ''}>${t('hostvault.regionOregon')}</option>
                <option value="eu-west-1" ${currentIntegration?.region === 'eu-west-1' ? 'selected' : ''}>${t('hostvault.regionIreland')}</option>
                <option value="eu-central-1" ${currentIntegration?.region === 'eu-central-1' ? 'selected' : ''}>${t('hostvault.regionFrankfurt')}</option>
              </select>
            </label>

            <!-- 存取金鑰 ID -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.accessKeyIdLabel')}
              <input class="no-drag" id="awsAccessKeyId" name="awsAccessKeyId" value="${escapeHtml(currentIntegration?.accessKeyId || '')}" placeholder="AKIA..." required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
            </label>

            <!-- 秘密存取金鑰 -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.secretAccessKeyLabel')}
              <input class="no-drag" id="awsSecretAccessKey" name="awsSecretAccessKey" type="password" placeholder="${secretPlaceholder}" ${currentIntegration ? '' : 'required'} style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
            </label>

            <!-- 匯入伺服器類型 -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.importSourceType')}
              <select class="no-drag" id="awsImportSource" name="awsImportSource" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                <option value="both" ${(!currentIntegration?.importSource || currentIntegration?.importSource === 'both') ? 'selected' : ''}>Both (EC2 & Lightsail)</option>
                <option value="ec2" ${currentIntegration?.importSource === 'ec2' ? 'selected' : ''}>EC2</option>
                <option value="lightsail" ${currentIntegration?.importSource === 'lightsail' ? 'selected' : ''}>Lightsail</option>
              </select>
            </label>

            <!-- 匯入 IP 位址類型 -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.importIpType')}
              <select class="no-drag" id="awsIpAddressType" name="awsIpAddressType" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                <option value="both" ${(!currentIntegration?.ipAddressType || currentIntegration?.ipAddressType === 'both') ? 'selected' : ''}>Both (Public & Private IP)</option>
                <option value="public" ${currentIntegration?.ipAddressType === 'public' ? 'selected' : ''}>Public IP</option>
                <option value="private" ${currentIntegration?.ipAddressType === 'private' ? 'selected' : ''}>Private IP</option>
              </select>
            </label>

            <!-- Add protocols 標題 -->
            <div style="border-top: 1px solid rgba(23,107,135,0.15); margin-top: 12px; padding-top: 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <h4 style="font-size: 12px; font-weight: 700; color: var(--color-text); margin: 0; text-transform: uppercase;">Add protocols</h4>
                <button type="button" id="toggleAwsSyncSettingsBtn" class="no-drag" style="background: transparent; border: 1px solid var(--color-primary); color: var(--color-primary); border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer;">
                  ${t('hostvault.cloudSyncSettings')} ${isExpanded ? '▲' : '▼'}
                </button>
              </div>

              <!-- 折疊的雲端同步設定 -->
              <div id="awsSyncSettingsContent" style="${expandedStyle}">
                <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                  Port
                  <input class="no-drag" id="awsDefaultPort" name="awsDefaultPort" type="number" min="1" max="65535" value="${currentIntegration?.defaultPort || 22}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                </label>
                <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                  Username
                  <input class="no-drag" id="awsDefaultUsername" name="awsDefaultUsername" value="${escapeHtml(currentIntegration?.defaultUsername || 'root')}" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                </label>
                <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                  ${t('hostvault.authMode')}
                  <select class="no-drag" id="awsAuthMode" name="awsAuthMode" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                    <option value="password" ${(!currentIntegration?.authMode || currentIntegration?.authMode === 'password') ? 'selected' : ''}>${t('hostvault.authPassword')}</option>
                    <option value="key" ${currentIntegration?.authMode === 'key' ? 'selected' : ''}>${t('hostvault.authKey')}</option>
                  </select>
                </label>
                <div id="awsPasswordAuth" style="${showPasswordStyle}">
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                    ${t('hostvault.defaultPassword')}
                    <input class="no-drag" id="awsDefaultPassword" name="awsDefaultPassword" type="password" autocomplete="new-password" placeholder="${t('hostvault.defaultPasswordPlaceholder')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  </label>
                </div>
                <div id="awsKeyAuth" style="${showKeyStyle}">
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                    ${t('hostvault.privateKeyPath')}
                    <input class="no-drag" id="awsPrivateKeyPath" name="awsPrivateKeyPath" value="${escapeHtml(currentIntegration?.privateKeyPath || '')}" placeholder="${t('hostvault.privateKeyPathPlaceholder')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  </label>
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                    ${t('hostvault.certPath')}
                    <input class="no-drag" id="awsCertPath" name="awsCertPath" value="${escapeHtml(currentIntegration?.certPath || '')}" placeholder="${t('hostvault.certPathPlaceholder')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 10px;">
            ${currentIntegration ? `<button type="button" id="awsDeleteBtn" data-integration-group-id="${escapeHtml(currentIntegration.groupId)}" class="no-drag" style="min-height: 38px; font-weight: 700; background: #e74c3c; border: none; border-radius: 6px; color: #fff; padding: 0 16px; cursor: pointer;">Delete</button>` : ''}
            <button type="submit" id="awsSubmitBtn" class="no-drag primary" style="flex: 1; min-height: 38px; font-weight: 700; background: var(--color-primary); border: none; border-radius: 6px; color: #fff; cursor: pointer;">${currentIntegration ? t('hostvault.saveAndResync') : t('hostvault.saveAndSync')}</button>
          </div>
        </form>
      </div>
    `;
  }

  renderGroupEditForm() {
    const group = this.selectedGroup || { name: "", id: "" };
    const state = hostStore.getState();
    const currentAws = (state.awsIntegrations || []).find(item => item.groupId === group.id);
    const currentAwsName = currentAws?.name || group.name;
    const relationHtml = currentAws ? `
      <div style="display: flex; flex-direction: column; gap: 6px; padding: 12px; background: rgba(255,153,0,0.08); border: 1px solid rgba(255,153,0,0.18); border-radius: 8px; text-align: left;">
        <span style="font-size: 12px; font-weight: 700; color: var(--color-text);">${escapeHtml(currentAwsName)}</span>
        <span style="font-size: 12px; color: var(--color-subtext);">${t('hostvault.regionColon', { value: escapeHtml(currentAws.region || t('hostvault.notSet')) })}</span>
        <span style="font-size: 12px; color: var(--color-subtext);">${t('hostvault.accessKeyColon', { value: escapeHtml(currentAws.accessKeyId ? `${currentAws.accessKeyId.slice(0, 8)}...` : t('hostvault.notSet')) })}</span>
      </div>
    ` : `
      <div style="padding: 12px; background: rgba(23,107,135,0.08); border: 1px dashed rgba(23,107,135,0.25); border-radius: 8px; font-size: 12px; color: var(--color-text-muted); text-align: left;">
        ${t('hostvault.groupNoIntegration')}
      </div>
    `;

    return `
      <div class="settings-dialog" style="width: 100% !important; height: 100% !important; max-height: 100% !important; border: none !important; box-shadow: none !important; transform: none !important; display: flex; flex-direction: column;">
        <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="font-size: 15px; font-weight: 700; color: var(--color-text); font-family: inherit;">${t('hostvault.editGroup')}</h2>
          <button type="button" aria-label="${t('hostvault.closeSettings')}" id="closeVaultDrawer" class="no-drag btn-icon icon-btn" title="${t('hostvault.closeSettings')}" style="font-size: 18px;">
            &times;
          </button>
        </div>

        <form id="groupEditForm" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; margin: 0;">
          <div class="settings-body" style="padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
            <div class="section-title" style="margin-bottom: 4px;">
               <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${t('hostvault.groupSettings')}</h3>
            </div>

            <!-- 群組名稱 -->
            <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
              ${t('hostvault.groupName')}
              <input class="no-drag" id="groupDrawerNameInput" name="groupDrawerNameInput" value="${escapeHtml(group.name)}" placeholder="${t('hostvault.groupNameExample')}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-weight: 600;">
            </label>

            <!-- AWS Integration 關聯顯示 -->
            <div style="border-top: 1px solid rgba(23,107,135,0.15); margin-top: 12px; padding-top: 12px; display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <span style="font-size: 12px; font-weight: 700; color: var(--color-text);">${t('hostvault.awsRelationDisplay')}</span>
                <button type="button" id="manageGroupAwsBtn" class="no-drag" style="min-height: 30px; font-weight: 700; font-size: 11px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 12px; border-radius: 4px; cursor: pointer;">${currentAws ? t('hostvault.goManage') : t('hostvault.createIntegration')}</button>
              </div>
              ${relationHtml}
            </div>
          </div>

          <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 10px;">
            <button type="button" id="vaultGroupDeleteBtn" class="no-drag" style="min-height: 38px; font-weight: 700; background: #e74c3c; border: none; border-radius: 6px; color: #fff; padding: 0 16px; cursor: pointer;">Delete</button>
            <button type="submit" id="saveGroupDrawerBtn" class="no-drag primary" style="flex: 1; min-height: 38px; font-weight: 700; background: var(--color-primary); border: none; border-radius: 6px; color: #fff; cursor: pointer; margin-left: auto;">Save</button>
          </div>
        </form>
      </div>
    `;
  }


  // 計算「會影響 HostListPage 畫面」的狀態指紋（H2）。
  // 涵蓋 render() 實際讀取的所有 store 切片：
  //   hostStore：hosts / groups / awsIntegrations / isLoading / loadError /
  //              activeGroupId / searchQuery / drawerOpen / drawerMode /
  //              selectedHost / selectedTab
  //   snippetStore：snippets / packages / selectedSnippet / editorOpen
  // 採完整序列化，寧可涵蓋過多也不漏；任何上述變更都會改變指紋而觸發重建，
  // 確保不會出現「狀態變了但畫面沒更新」的回歸。指紋未變時（例如後端輪詢回傳
  // 內容相同、或無關 store 操作）即可安全跳過整頁 render + 重綁事件。
  // 注意：此 guard 僅用於 store 訂閱回呼；元件內以 this.render() 直接觸發的
  // 局部互動（如展開 snippet 抽屜）不經過 guard，行為完全不變。
  getViewFingerprint() {
    const h = hostStore.getState();
    const s = snippetStore.getState();
    try {
      return JSON.stringify({
        hosts: h.hosts,
        groups: h.groups,
        awsIntegrations: h.awsIntegrations,
        isLoading: h.isLoading,
        loadError: h.loadError,
        activeGroupId: h.activeGroupId,
        searchQuery: h.searchQuery,
        drawerOpen: h.drawerOpen,
        drawerMode: h.drawerMode,
        selectedHost: h.selectedHost,
        selectedTab: h.selectedTab,
        snippets: s.snippets,
        packages: s.packages,
        selectedSnippet: s.selectedSnippet,
        editorOpen: s.editorOpen
      });
    } catch (e) {
      // 序列化失敗（理論上不會發生）時回傳唯一值，強制重建以確保安全。
      return `__fingerprint_error__${Date.now()}_${Math.random()}`;
    }
  }

  render() {
    const activeElementId = document.activeElement ? document.activeElement.id : null;
    let selectionStart = null;
    let selectionEnd = null;
    if (activeElementId && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      selectionStart = document.activeElement.selectionStart;
      selectionEnd = document.activeElement.selectionEnd;
    }

    let snippetDrawerHtml = "";
    let packageDrawerHtml = "";
    const state = hostStore.getState();
    const activeGroupId = state.activeGroupId;
    const selectedTab = state.selectedTab;
    const searchQuery = state.searchQuery.toLowerCase().trim();

    // 1. 搜尋過濾
    let filteredHosts = state.hosts;
    if (searchQuery !== "") {
      filteredHosts = state.hosts.filter(item => {
        const label = (item.label || '').toLowerCase();
        const alias = (item.alias || '').toLowerCase();
        const host = (item.config?.host || '').toLowerCase();
        const username = (item.config?.username || '').toLowerCase();
        return label.includes(searchQuery) || alias.includes(searchQuery) || host.includes(searchQuery) || username.includes(searchQuery);
      });
    } else if (activeGroupId !== null) {
      // 群組過濾
      filteredHosts = state.hosts.filter(item => item.groupId === activeGroupId);
    } else {
      // 頂層只顯示無群組的主機
      filteredHosts = state.hosts.filter(item => !item.groupId);
    }

    const currentGroup = state.groups.find(g => g.id === activeGroupId);
    const hostVaultStatusHtml = selectedTab === 'hosts'
      ? (state.loadError
        ? `<div style="margin-bottom: 16px; padding: 12px 14px; border: 1px solid rgba(239,68,68,0.28); border-radius: 8px; color: #fca5a5; font-size: 12.5px;">${t('hostvault.loadFailed', { error: escapeHtml(state.loadError) })}</div>`
        : '')
      : '';

    // 渲染左側選單
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
      const activeClass = selectedTab === tab.id ? 'active' : '';
      return `
        <div class="vault-menu-item no-drag ${activeClass}" data-tab="${tab.id}" role="button" tabindex="0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${tab.icon}
          </svg>
          <span>${tab.label}</span>
        </div>
      `;
    }).join('');

    // 渲染 Groups Grid (僅在 Hosts 分頁且無搜尋時顯示)
    let groupsGridHtml = "";
    if (selectedTab === 'hosts' && searchQuery === "" && activeGroupId === null) {
      const groupsHtml = state.groups.map(group => {
        const count = state.hosts.filter(h => h.groupId === group.id).length;
        return `
          <div class="vault-card group-folder" data-group-id="${group.id}" title="${t('hostvault.enterGroup', { name: group.name })}" role="button" tabindex="0" aria-label="${t('hostvault.enterGroup', { name: group.name })}">
            <div class="vault-card-icon" style="background: var(--color-primary); border-radius: 8px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="vault-card-info">
              <div class="vault-card-title">${group.name}</div>
              <div class="vault-card-details">${count} Hosts</div>
            </div>
            <button type="button" aria-label="${t('hostvault.editGroupTitle')}" class="no-drag vault-group-edit-btn" data-group-id="${group.id}" title="${t('hostvault.editGroupTitle')}" style="margin-left: auto;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        `;
      }).join('');

      groupsGridHtml = `
        <div id="vaultGroupsSection" class="vault-section">
          <h3 style="font-size: 14px; font-weight: 700; color: var(--color-text-muted); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">Groups</h3>
          <div id="vaultGroupsGrid" class="vault-grid">${groupsHtml || `<div style="color: var(--color-text-muted); font-size: 13px;">${t('hostvault.noGroups')}</div>`}</div>
        </div>
      `;
    }

    // 渲染 Hosts Grid
    let hostsGridHtml = "";
    if (selectedTab === 'hosts') {
      const hostsHtml = filteredHosts.map(item => {
        const isAws = (item.config?.host || '').toLowerCase().includes('aws') || (item.alias || '').toLowerCase().includes('aws');
        const isUbuntu = (item.config?.host || '').toLowerCase().includes('ubuntu') || (item.alias || '').toLowerCase().includes('ubuntu');
        let iconBg = "var(--color-primary)";
        let iconSvg = `<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>`;

        if (isAws) {
          iconBg = "#FF9900";
          iconSvg = `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`;
        } else if (isUbuntu) {
          iconBg = "#E95420";
          iconSvg = `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/>`;
        }

        return `
          <div class="vault-card history-item" data-id="${item.id}" draggable="true" title="${t('hostvault.hostCardTitle', { label: item.label })}" role="button" tabindex="0" aria-label="${t('hostvault.connectTo', { name: item.alias || item.label })}">
            <div class="vault-card-icon" style="background: ${iconBg};">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                ${iconSvg}
              </svg>
            </div>
            <div class="vault-card-info">
              <div class="vault-card-title">${item.alias || item.label}</div>
              <div class="vault-card-details">ssh, ${item.config?.username}@${item.config?.host}</div>
            </div>
            <button type="button" aria-label="${t('hostvault.editHostSettings')}" class="no-drag vault-card-edit-btn" data-id="${item.id}" title="${t('hostvault.editHostSettings')}" style="background: transparent; border: none; padding: 6px; cursor: pointer; color: var(--color-subtext); display: inline-flex; align-items: center; justify-content: center; margin-left: auto;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        `;
      }).join('');

      // 初始載入時顯示 skeleton，與「載入完成但無資料」的空狀態區分，避免誤導。
      const isInitialLoading = state.isLoading && filteredHosts.length === 0 && !state.loadError;
      let hostsGridInnerHtml;
      if (isInitialLoading) {
        hostsGridInnerHtml = Array.from({ length: 3 }).map(() => `
          <div class="vault-card host-skeleton-card" aria-hidden="true" style="pointer-events: none;">
            <div class="vault-card-icon host-skeleton-block" style="border-radius: 8px;"></div>
            <div class="vault-card-info" style="display: flex; flex-direction: column; gap: 8px; flex: 1;">
              <div class="host-skeleton-block" style="height: 13px; width: 55%; border-radius: 4px;"></div>
              <div class="host-skeleton-block" style="height: 11px; width: 78%; border-radius: 4px;"></div>
            </div>
          </div>
        `).join('');
      } else {
        hostsGridInnerHtml = hostsHtml || `<div style="color: var(--color-text-muted); font-size: 13px;">${t('hostvault.noHosts')}</div>`;
      }

      hostsGridHtml = `
        <div id="vaultHostsSection" class="vault-section" style="margin-top: 24px;">
          <h3 style="font-size: 14px; font-weight: 700; color: var(--color-text-muted); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">Hosts${isInitialLoading ? `<span class="host-loading-indicator" role="status" aria-live="polite" style="margin-left: 8px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--color-subtext); font-size: 11px;">${t('common.loading')}</span>` : ''}</h3>
          <div id="vaultHostsGrid" class="vault-grid">${hostsGridInnerHtml}</div>
        </div>
      `;
    }

    let mainBoardHtml = "";
    if (selectedTab === 'hosts') {
      mainBoardHtml = `
          <div class="vault-search-bar" style="display: flex; gap: 10px; margin-bottom: 20px; align-items: center; flex: 0 0 auto;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="no-drag" id="vaultSearchInput" placeholder="Find a host or ssh user@hostname..." autocomplete="off" value="${state.searchQuery}" style="flex: 1; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
            <button type="button" id="vaultSearchConnectBtn" class="no-drag primary" style="padding: 8px 18px; font-weight: 700; background: var(--color-primary); border: none; border-radius: 6px; color: #fff; cursor: pointer;">CONNECT</button>
          </div>

          <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex: 0 0 auto;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <div class="termix-dropdown no-drag" style="display: inline-flex; vertical-align: middle; position: relative;">
                <div style="display: inline-flex; background: var(--color-primary); border-radius: 4px;">
                  <button type="button" id="addConnection" class="no-drag primary" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: var(--color-primary); border: none; color: #fff; cursor: pointer; border-right: 1px solid rgba(255, 255, 255, 0.2); border-top-left-radius: 4px; border-bottom-left-radius: 4px;">+ NEW HOST</button>
                  <button type="button" class="no-drag termix-dropdown-trigger" style="min-height: 32px; width: 24px; padding: 0; background: var(--color-primary); border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px; border-top-right-radius: 4px; border-bottom-right-radius: 4px;">▼</button>
                  <div class="termix-dropdown-menu" style="top: 100%; right: 0; left: auto;">
                    <button type="button" class="no-drag termix-dropdown-item" id="awsIntegrationBtn">AWS Integration</button>
                  </div>
                </div>
              </div>
              <button class="no-drag" type="button" id="addGroupBtn" style="min-height: 32px; font-weight: 700; font-size: 12px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 14px; border-radius: 4px; cursor: pointer;">+ NEW GROUP</button>
              <div class="termix-dropdown no-drag">
                <button class="no-drag termix-dropdown-trigger" type="button" id="exportDropdownBtn" style="min-height: 32px; font-weight: 700; font-size: 12px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 14px; border-radius: 4px; cursor: pointer;" title="${t('hostvault.exportTooltip')}">Export ▼</button>
                <div class="termix-dropdown-menu">
                  <button type="button" class="no-drag termix-dropdown-item" id="exportHostsJsonBtn">Export JSON</button>
                  <button type="button" class="no-drag termix-dropdown-item" id="exportHostsYamlBtn">Export YAML</button>
                </div>
              </div>
              <div class="termix-dropdown no-drag">
                <button class="no-drag termix-dropdown-trigger" type="button" id="importDropdownBtn" style="min-height: 32px; font-weight: 700; font-size: 12px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 14px; border-radius: 4px; cursor: pointer;" title="${t('hostvault.importTooltip')}">Import ▼</button>
                <div class="termix-dropdown-menu">
                  <button type="button" class="no-drag termix-dropdown-item" id="importHostsJsonBtn">Import JSON</button>
                  <button type="button" class="no-drag termix-dropdown-item" id="importHostsYamlBtn">Import YAML</button>
                </div>
              </div>
            </div>

            <!-- 麵包屑路徑 -->
            <div id="vaultBreadcrumbs" class="vault-breadcrumbs ${currentGroup ? '' : 'hidden'}" style="font-size: 13px; font-weight: 600; color: var(--color-primary); cursor: pointer; display: flex; align-items: center; gap: 4px; margin-left: 16px;">
              <span>Vaults</span>
              <span style="color: var(--color-text-muted);">/</span>
              <span id="breadcrumbGroupName" style="color: var(--color-text);">${currentGroup ? currentGroup.name : ''}</span>
            </div>
          </div>

          <div class="vault-scroll-content" style="flex: 1; min-height: 0; overflow-y: auto;">
            ${groupsGridHtml}
            ${hostsGridHtml}
          </div>
      `;
    } else if (selectedTab === 'integrations') {
      mainBoardHtml = this.renderIntegrationsPage(state);
    } else if (selectedTab === 'kubernetes') {
      mainBoardHtml = `<kubernetes-page></kubernetes-page>`;
    } else if (selectedTab === 'logs') {
      const logs = readSessionLogs();
      const tableRows = logs.map(log => {
        const initial = log.userEmail ? log.userEmail.charAt(0).toUpperCase() : 'U';
        const hostIcon = log.isAutomation ? `
          <div class="log-avatar" style="background: linear-gradient(135deg, #ef4444, #f59e0b); display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 13px;">A</div>
        ` : (log.protocol === 'local' ? `
          <div class="log-avatar" style="background: linear-gradient(135deg, #8b5cf6, #ec4899); display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 13px;">L</div>
        ` : `
          <div class="log-avatar" style="background: linear-gradient(135deg, #176b87, #2ecc71); display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 13px;">${initial}</div>
        `);

        return `
          <tr class="log-record-row no-drag" data-log-id="${log.id}" style="border-bottom: 1px solid rgba(23, 107, 135, 0.15); cursor: pointer; transition: background 0.2s;">
            <td style="padding: 14px 0 14px 16px; width: 36px;">
              <input type="checkbox" class="no-drag log-select-checkbox" data-log-id="${log.id}" aria-label="${t('hostvault.selectLog')}" style="width: 14px; height: 14px; cursor: pointer;">
            </td>
            <td style="padding: 14px 16px; white-space: pre-line; line-height: 1.4; font-weight: 500; text-align: left;">
              <span style="color: var(--color-text); font-size: 13px;">${escapeHtml(log.dateStr)}</span>
              <br>
              <span style="color: var(--color-text-muted); font-size: 11px;">${escapeHtml(log.timeStr)}</span>
            </td>
            <td style="padding: 14px 16px;">
              <div class="log-avatar-container" style="display: flex; align-items: center; gap: 10px;">
                ${hostIcon}
                <div class="log-avatar-info" style="display: flex; flex-direction: column; text-align: left;">
                  <span class="log-user-email" style="font-size: 13px; font-weight: 600; color: ${log.isAutomation ? '#ef4444' : 'var(--color-text)'};">${escapeHtml(log.userEmail || (log.isAutomation ? log.automationObject : 'local-user'))}</span>
                  <span class="log-machine-name" style="font-size: 11px; color: var(--color-text-muted);">${escapeHtml(log.isAutomation ? 'Control Panel Object' : (log.machineName || 'macOS'))}</span>
                </div>
              </div>
            </td>
            <td style="padding: 14px 16px;">
              <div class="log-host-info" style="display: flex; flex-direction: column; text-align: left;">
                <span class="log-host-ip" style="font-size: 13px; font-weight: 600; color: var(--color-text);">${escapeHtml(log.hostName)}</span>
                <span class="log-host-alias" style="font-size: 11px; color: var(--color-text-muted);">${escapeHtml(log.hostAlias)}</span>
              </div>
            </td>
            <td style="padding: 14px 16px; text-align: right;">
              <button type="button" class="no-drag" style="background: transparent; border: none; padding: 4px; color: var(--color-primary); cursor: pointer;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      mainBoardHtml = `
          <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex: 0 0 auto;">
            <div style="display: flex; gap: 8px;">
              <button type="button" id="selectAllLogsBtn" class="no-drag" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: transparent; border: 1px solid var(--color-primary); border-radius: 4px; color: var(--color-primary); cursor: pointer;">${t('hostvault.selectAll')}</button>
              <button type="button" id="deleteSelectedLogsBtn" class="no-drag" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: #ef4444; border: none; border-radius: 4px; color: #fff; cursor: pointer;">${t('hostvault.deleteSelected')}</button>
              <button type="button" id="clearGlobalLogsBtn" class="no-drag" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: #7f1d1d; border: none; border-radius: 4px; color: #fff; cursor: pointer;">${t('hostvault.clearAll')}</button>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: var(--color-text-muted); text-align: right;">${t('hostvault.logsSubtitle')}</div>
          </div>

          <div id="logsTerminalContainer" style="flex: 1; overflow-y: auto; background: rgba(12, 18, 31, 0.5); border: 1px solid rgba(23, 107, 135, 0.15); border-radius: 8px; min-height: 250px;">
            ${logs.length === 0 ? `
              <div style="padding: 40px; text-align: center; color: var(--color-text-muted); font-size: 14px;">
                ${t('hostvault.noLogs')}
              </div>
            ` : `
              <div style="overflow-x: auto; width: 100%;">
                <table class="logs-table" style="width: 100%; border-collapse: collapse; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid rgba(23, 107, 135, 0.25); color: var(--color-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                      <th style="padding: 14px 0 14px 16px; width: 36px;"></th>
                      <th style="padding: 14px 16px; text-align: left;">Date</th>
                      <th style="padding: 14px 16px; text-align: left;">User</th>
                      <th style="padding: 14px 16px; text-align: left;">Host</th>
                      <th style="padding: 14px 16px; text-align: right;">Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${tableRows}
                  </tbody>
                </table>
              </div>
            `}
          </div>
      `;
    } else if (selectedTab === 'snippets') {
      const snipState = snippetStore.getState();
      const snippets = snipState.snippets;
      const packages = snipState.packages;
      const selectedSnippet = snipState.selectedSnippet || {
        id: '',
        name: '',
        description: '',
        script: '',
        packageId: '',
        targetHostIds: []
      };
      const selectedTargetIds = new Set(selectedSnippet.targetHostIds || []);
      const packageOptions = packages.map(pkg => `
        <option value="${pkg.id}" ${selectedSnippet.packageId === pkg.id ? 'selected' : ''}>${escapeHtml(pkg.name)}</option>
      `).join('');

      // 依據 activePackageId 與 searchQuery 過濾 Snippet
      const activePackageId = this.activePackageId || 'all';
      const showAll = this.showAllSnippets ?? false;
      let filteredSnippets = snippets;
      if (searchQuery !== "") {
        filteredSnippets = snippets.filter(s =>
          (s.name || '').toLowerCase().includes(searchQuery) ||
          (s.description || '').toLowerCase().includes(searchQuery)
        );
      } else if (activePackageId !== 'all') {
        filteredSnippets = snippets.filter(s => s.packageId === activePackageId);
      } else {
        // 頂層
        if (showAll) {
          filteredSnippets = snippets;
        } else {
          // 僅顯示無分類的 Snippet
          filteredSnippets = snippets.filter(s => !s.packageId);
        }
      }

      const snippetCards = filteredSnippets.map(snippet => `
        <div class="vault-card snippet-card" data-snippet-id="${snippet.id}" draggable="true" title="${t('hostvault.snippetDoubleClickRun', { name: escapeHtml(snippet.name) })}">
          <div class="vault-card-icon" style="background: var(--color-primary);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
          </div>
          <div class="vault-card-info">
            <div class="vault-card-title">${escapeHtml(snippet.name)}</div>
            <div class="vault-card-details">${escapeHtml(formatSnippetPackageName(snippet.packageId, packages))}</div>
          </div>
          <div style="display: flex; gap: 4px; margin-left: auto;">
            <button type="button" class="no-drag snippet-paste-btn" data-snippet-id="${snippet.id}" title="${t('hostvault.pasteToTerminal')}" style="background: transparent; border: none; padding: 6px; cursor: pointer; color: var(--color-subtext); font-size: 11px; font-weight: 800;">PASTE</button>
            <button type="button" class="no-drag snippet-run-btn" data-snippet-id="${snippet.id}" title="${t('hostvault.runInTerminal')}" style="background: var(--color-primary); border: none; padding: 6px 9px; cursor: pointer; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 800;">RUN</button>
          </div>
        </div>
      `).join('');

      // 渲染 Packages Grid (僅在頂層且無搜尋時顯示，以方塊方式呈現)
      let packagesGridHtml = "";
      if (searchQuery === "" && activePackageId === 'all') {
        const packagesHtml = packages.map(pkg => {
          const count = snippets.filter(s => s.packageId === pkg.id).length;
          return `
            <div class="vault-card package-folder" data-package-id="${pkg.id}" title="${t('hostvault.enterCategory', { name: escapeHtml(pkg.name) })}">
              <div class="vault-card-icon" style="background: var(--color-primary); border-radius: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div class="vault-card-info">
                <div class="vault-card-title">${escapeHtml(pkg.name)}</div>
                <div class="vault-card-details">${count} Snippets</div>
              </div>
              <button type="button" aria-label="${t('hostvault.editCategory')}" class="no-drag snippet-package-edit-btn" data-package-id="${pkg.id}" title="${t('hostvault.editCategory')}" style="background: transparent; border: none; padding: 6px; cursor: pointer; color: var(--color-subtext); display: inline-flex; align-items: center; justify-content: center; margin-left: auto;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
          `;
        }).join('');

        packagesGridHtml = `
          <div id="vaultPackagesSection" class="vault-section">
            <h3 style="font-size: 14px; font-weight: 700; color: var(--color-text-muted); margin-bottom: 12px; text-align: left; letter-spacing: 0.5px; text-transform: uppercase;">Packages</h3>
            <div id="vaultPackagesGrid" class="vault-grid">${packagesHtml || `<div style="color: var(--color-text-muted); font-size: 13px;">${t('hostvault.noCategories')}</div>`}</div>
          </div>
        `;
      }

      const currentPackage = packages.find(p => p.id === activePackageId);
      const isTopLevelNoSearch = (activePackageId === 'all' && searchQuery === "");
      const snippetsGridHtml = `
        <div id="vaultSnippetsSection" class="vault-section" style="margin-top: ${packagesGridHtml ? '24px' : '0'};">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <h3 style="font-size: 14px; font-weight: 700; color: var(--color-text-muted); margin: 0; letter-spacing: 0.5px; text-transform: uppercase;">Snippets</h3>
            ${isTopLevelNoSearch ? `
              <button type="button" id="toggleShowAllSnippetsBtn" class="no-drag" style="background: transparent; border: 1px solid var(--color-primary); color: var(--color-primary); padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 700;">
                ${showAll ? t('hostvault.showUncategorized') : t('hostvault.showAll')}
              </button>
            ` : ''}
          </div>
          <div id="vaultSnippetsGrid" class="vault-grid">${snippetCards || `<div style="color: var(--color-text-muted); font-size: 13px;">${t('hostvault.noSnippets')}</div>`}</div>
        </div>
      `;

      const targetRows = this.buildBatchTargetsHtml(state, selectedTargetIds);

      mainBoardHtml = `
        <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex: 0 0 auto;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <button type="button" id="newSnippetBtn" class="no-drag primary" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: var(--color-primary); border: none; border-radius: 4px; color: #fff; cursor: pointer;">+ NEW SNIPPET</button>
            <button type="button" id="newSnippetPackageBtn" class="no-drag" style="min-height: 32px; font-weight: 700; font-size: 12px; border: 1px solid var(--color-primary); color: var(--color-primary); background: transparent; padding: 0 14px; border-radius: 4px; cursor: pointer;">+ NEW PACKAGE</button>

            <!-- 腳本麵包屑 -->
            <div id="snippetBreadcrumbs" class="vault-breadcrumbs ${activePackageId !== 'all' ? '' : 'hidden'}" style="font-size: 13px; font-weight: 600; color: var(--color-primary); cursor: pointer; display: flex; align-items: center; gap: 4px; margin-left: 16px;">
              <span>Snippets</span>
              <span style="color: var(--color-text-muted);">/</span>
              <span id="breadcrumbPackageName" style="color: var(--color-text);">${currentPackage ? escapeHtml(currentPackage.name) : ''}</span>
            </div>
          </div>
          <div style="font-size: 13px; font-weight: 600; color: var(--color-text-muted); text-align: right;">${t('hostvault.snippetsSubtitle')}</div>
        </div>

        <div style="display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; overflow-y: auto;">
          ${packagesGridHtml}
          ${snippetsGridHtml}
        </div>
      `;

      snippetDrawerHtml = `
        <div class="settings-dialog" style="width: 100% !important; height: 100% !important; max-height: 100% !important; border: none !important; box-shadow: none !important; transform: none !important; display: flex; flex-direction: column;">
          <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; justify-content: space-between; align-items: center;">
            <h2 id="modalTitle" style="font-size: 15px; font-weight: 700; color: var(--color-text);">${selectedSnippet.id ? 'Edit Snippet' : 'New Snippet'}</h2>
            <button type="button" aria-label="${t('hostvault.closeSettings')}" id="closeVaultDrawer" class="no-drag btn-icon icon-btn" title="${t('hostvault.closeSettings')}" style="font-size: 18px;">
              &times;
            </button>
          </div>

          <form id="snippetForm" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; margin: 0;">
            <div class="settings-body" style="padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;">
              <label style="display: flex; flex-direction: column; gap: 6px; text-align: left; font-size: 12px; color: var(--color-subtext);">
                Name
                <input id="snippetNameInput" class="no-drag" value="${escapeHtml(selectedSnippet.name || '')}" placeholder="${t('hostvault.snippetNamePlaceholder')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px; text-align: left; font-size: 12px; color: var(--color-subtext);">
                Package
                <select id="snippetPackageSelect" class="no-drag" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  <option value="">Unpackaged</option>
                  ${packageOptions}
                </select>
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px; text-align: left; font-size: 12px; color: var(--color-subtext);">
                Description
                <input id="snippetDescriptionInput" class="no-drag" value="${escapeHtml(selectedSnippet.description || '')}" placeholder="${t('hostvault.snippetDescPlaceholder')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px; text-align: left; font-size: 12px; color: var(--color-subtext);">
                Script
                <textarea id="snippetScriptInput" class="no-drag" spellcheck="false" style="min-height: 150px; resize: vertical; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 10px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace; line-height: 1.5;">${escapeHtml(selectedSnippet.script || '')}</textarea>
              </label>
              <style>
                .batch-group-row:hover, .batch-host-row:hover {
                  background: rgba(255, 255, 255, 0.04) !important;
                }
                #backToGroupListBtn:hover {
                  background: rgba(255, 255, 255, 0.05) !important;
                  border-color: rgba(23, 107, 135, 0.5) !important;
                }
              </style>
              <div style="border-top: 1px solid rgba(23,107,135,0.15); padding-top: 12px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 12px; color: var(--color-subtext); font-weight: 700;">Batch targets</span>
                </div>
                <input type="text" id="batchTargetsSearchInput" placeholder="${t('hostvault.batchSearchPlaceholder')}" style="width: 100%; background: var(--input-bg); border: 1px solid rgba(23, 107, 135, 0.2); padding: 6px 10px; border-radius: 6px; color: var(--color-text); font-size: 12px; box-sizing: border-box;" class="no-drag">
                <div style="height: 250px; overflow-y: auto; padding-right: 4px; border: 1px solid rgba(23, 107, 135, 0.15); border-radius: 6px; padding: 8px; background: rgba(0, 0, 0, 0.15);">
                  ${targetRows || `<div style="color: var(--color-text-muted); font-size: 12.5px; text-align: left;">${t('hostvault.noSelectableHosts')}</div>`}
                </div>
              </div>
            </div>
            <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
              ${selectedSnippet.id ? `<button type="button" id="deleteSnippetBtn" class="no-drag" style="background: #7f1d1d; color: #fff; border: none; border-radius: 5px; padding: 0 12px; min-height: 34px; font-size: 12px; font-weight: 800; cursor: pointer; margin-right: auto;">Delete</button>` : ''}
              <button type="button" id="runSnippetTargetsBtn" class="no-drag" ${selectedSnippet.id ? '' : 'disabled'} style="min-height: 34px; padding: 0 12px; border: 1px solid var(--color-primary); background: transparent; color: var(--color-primary); border-radius: 5px; font-size: 12px; font-weight: 800; cursor: ${selectedSnippet.id ? 'pointer' : 'default'};">Run</button>
              <button type="button" id="saveSnippetBtn" class="no-drag primary" style="min-height: 34px; padding: 0 14px; border: none; background: var(--color-primary); color: #fff; border-radius: 5px; font-size: 12px; font-weight: 800; cursor: pointer;">Save</button>
            </div>
          </form>
        </div>
      `;

      const selectedPackage = this.selectedPackage || { id: '', name: '' };
      packageDrawerHtml = `
        <div class="settings-dialog" style="width: 100% !important; height: 100% !important; max-height: 100% !important; border: none !important; box-shadow: none !important; transform: none !important; display: flex; flex-direction: column;">
          <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="font-size: 15px; font-weight: 700; color: var(--color-text);">${selectedPackage.id ? 'Edit Package' : 'New Package'}</h2>
            <button type="button" aria-label="${t('hostvault.closeSettings')}" id="closeVaultDrawer" class="no-drag btn-icon icon-btn" title="${t('hostvault.closeSettings')}" style="font-size: 18px;">
              &times;
            </button>
          </div>
          <form id="snippetPackageForm" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; margin: 0;">
            <div class="settings-body" style="padding: 20px; flex: 1; overflow-y: auto;">
              <div class="section-title" style="margin-bottom: 12px;">
                <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase;">Package</h3>
              </div>
              <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                Name
                <input class="no-drag" id="snippetPackageNameInput" value="${escapeHtml(selectedPackage.name || '')}" placeholder="${t('hostvault.packageNamePlaceholder')}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
              </label>
            </div>
            <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
              ${selectedPackage.id ? `<button type="button" id="deleteSnippetPackageBtn" class="no-drag" style="background: #7f1d1d; color: #fff; border: none; border-radius: 5px; padding: 0 12px; min-height: 34px; font-size: 12px; font-weight: 800; cursor: pointer; margin-right: auto;">Delete</button>` : ''}
              <button type="submit" id="saveSnippetPackageBtn" class="no-drag primary" style="min-height: 34px; padding: 0 14px; border: none; background: var(--color-primary); color: #fff; border-radius: 5px; font-size: 12px; font-weight: 800; cursor: pointer;">Save</button>
            </div>
          </form>
        </div>
      `;
    } else if (selectedTab === 'keychain') {
      const keys = this.keychainKeys;
      const rows = keys.map(k => `
        <tr style="border-bottom: 1px solid rgba(23, 107, 135, 0.15); transition: background 0.2s;">
          <td style="padding: 14px 16px; text-align: left; font-size: 13px; font-weight: 700; color: var(--color-text);">${escapeHtml(k.label)}${k.hasPassphrase ? ' <span title="' + escapeHtml(t('hostvault.keychainPassphraseProtected')) + '" style="color: var(--color-text-muted);">🔒</span>' : ''}</td>
          <td style="padding: 14px 16px; text-align: left; font-size: 12.5px; color: var(--color-text-muted);">${escapeHtml(formatKeychainType(k))}</td>
          <td style="padding: 14px 16px; text-align: left; font-size: 11px; color: var(--color-text-muted); font-family: monospace;">${escapeHtml(k.fingerprint)}</td>
          <td style="padding: 14px 16px; text-align: left; font-size: 12.5px; color: var(--color-text-muted);">${escapeHtml(k.comment)}</td>
          <td style="padding: 14px 16px; text-align: right; white-space: nowrap;">
            <button type="button" aria-label="${t('hostvault.keychainCopyPublic')}" class="no-drag copy-pubkey-btn icon-btn" data-id="${k.id}" style="font-size: 15px; display: inline-flex; margin-right: 4px;" title="${t('hostvault.keychainCopyPublic')}">⧉</button>
            <button type="button" aria-label="${t('hostvault.removeKey')}" class="no-drag delete-key-btn icon-btn danger" data-id="${k.id}" style="font-size: 18px; display: inline-flex;" title="${t('hostvault.removeKey')}">&times;</button>
          </td>
        </tr>
      `).join('');

      mainBoardHtml = `
          <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex: 0 0 auto;">
            <div style="display: flex; gap: 8px;">
              <button type="button" id="generateKeyBtn" class="no-drag primary" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: var(--color-primary); border: none; border-radius: 4px; color: #fff; cursor: pointer;">${t('hostvault.keychainGenerate')}</button>
              <button type="button" id="importKeyBtn" class="no-drag" style="min-height: 32px; font-weight: 700; font-size: 12px; padding: 0 14px; background: transparent; border: 1px solid rgba(23,107,135,0.35); border-radius: 4px; color: var(--color-text); cursor: pointer;">${t('hostvault.keychainImport')}</button>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: var(--color-text-muted); text-align: right;">${t('hostvault.keychainSubtitle')}</div>
          </div>

          <div style="flex: 1; overflow-y: auto; background: rgba(12, 18, 31, 0.5); border: 1px solid rgba(23, 107, 135, 0.15); border-radius: 8px; min-height: 250px;">
            ${!this.keychainLoaded ? `
              <div style="padding: 40px; text-align: center; color: var(--color-text-muted); font-size: 14px;">
                ${t('hostvault.keychainLoading')}
              </div>
            ` : keys.length === 0 ? `
              <div style="padding: 40px; text-align: center; color: var(--color-text-muted); font-size: 14px;">
                ${t('hostvault.noKeys')}
              </div>
            ` : `
              <div style="overflow-x: auto; width: 100%;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid rgba(23, 107, 135, 0.25); color: var(--color-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                      <th style="padding: 14px 16px; text-align: left;">Name</th>
                      <th style="padding: 14px 16px; text-align: left;">Type</th>
                      <th style="padding: 14px 16px; text-align: left;">Fingerprint</th>
                      <th style="padding: 14px 16px; text-align: left;">Comment</th>
                      <th style="padding: 14px 16px; text-align: right;">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>
            `}
          </div>
      `;
    } else if (selectedTab === 'known_hosts') {
      const hosts = this.knownHosts;
      const rows = hosts.map((h, i) => `
        <tr style="border-bottom: 1px solid rgba(23, 107, 135, 0.15); transition: background 0.2s;">
          <td style="padding: 14px 16px; text-align: left; font-size: 13px; font-weight: 700; color: var(--color-text);">${escapeHtml(h.host)}</td>
          <td style="padding: 14px 16px; text-align: left; font-size: 12.5px; color: var(--color-text-muted);">${escapeHtml(h.type)}</td>
          <td style="padding: 14px 16px; text-align: left; font-size: 11px; color: var(--color-text-muted); font-family: monospace;">${escapeHtml(h.fingerprint)}</td>
          <td style="padding: 14px 16px; text-align: right;">
            <button type="button" aria-label="${t('hostvault.removeFingerprint')}" class="no-drag delete-kh-btn icon-btn danger" data-index="${i}" style="font-size: 18px; display: inline-flex;" title="${t('hostvault.removeFingerprint')}">&times;</button>
          </td>
        </tr>
      `).join('');
      const emptyText = this.knownHostsLoading ? t('hostvault.knownHostsLoading') : t('hostvault.noKnownHosts');

      mainBoardHtml = `
          <div class="vault-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex: 0 0 auto;">
            <div style="font-size: 13px; font-weight: 600; color: var(--color-text-muted); text-align: right;">${t('hostvault.knownHostsSubtitle')}</div>
          </div>

          <div style="flex: 1; overflow-y: auto; background: rgba(12, 18, 31, 0.5); border: 1px solid rgba(23, 107, 135, 0.15); border-radius: 8px; min-height: 250px;">
            ${hosts.length === 0 ? `
              <div style="padding: 40px; text-align: center; color: var(--color-text-muted); font-size: 14px;">
                ${emptyText}
              </div>
            ` : `
              <div style="overflow-x: auto; width: 100%;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid rgba(23, 107, 135, 0.25); color: var(--color-text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                      <th style="padding: 14px 16px; text-align: left;">Host Address</th>
                      <th style="padding: 14px 16px; text-align: left;">Key Type</th>
                      <th style="padding: 14px 16px; text-align: left;">Host Fingerprint</th>
                      <th style="padding: 14px 16px; text-align: right;">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>
            `}
          </div>
      `;
    } else {
      mainBoardHtml = `
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; height: 300px; color: var(--color-text-muted); font-size: 14px;">
          ${t('hostvault.moduleComingSoon', { name: selectedTab.toUpperCase() })}
        </div>
      `;
    }

    const defaultDrawerHost = {
      label: '',
      alias: '',
      config: DEFAULT_HOST_CONFIG
    };
    const drawerHost = {
      ...defaultDrawerHost,
      ...(state.selectedHost || {}),
      config: {
        ...defaultDrawerHost.config,
        ...(state.selectedHost?.config || {})
      }
    };

    const availableComps = getAvailableControlPanelComponents();
    const hostCustomComps = normalizeMountedComponents(drawerHost.config?.customComponents, availableComps);
    const enabledCompIds = new Set(hostCustomComps.map(c => c.id));
    const allSnippets = snippetStore.getState().snippets;
    const startupCommandDefaults = getStartupCommandDefaults(drawerHost.config || {});
    const startupSnippetOptions = allSnippets.map(snippet => `
      <option value="${snippet.id}" ${startupCommandDefaults.startupSnippetId === snippet.id ? 'selected' : ''}>${escapeHtml(snippet.name)}</option>
    `).join('');

    this.innerHTML = `
      <div id="hostVaultPanel" class="host-vault-panel" style="display: flex; flex: 1; height: 100%; min-height: 0;">
        <!-- 第一欄：左側選單 -->
        <div class="vault-sub-sidebar">${sidebarHtml}</div>

        <!-- 第二欄：中央 Vault 主面板 -->
        <div class="vault-main-board ${selectedTab === 'kubernetes' ? 'kubernetes-host-board' : ''}" style="flex: 1; display: flex; flex-direction: column; min-width: 0; padding: ${selectedTab === 'kubernetes' ? '0' : '20px'}; overflow-y: ${selectedTab === 'kubernetes' ? 'hidden' : 'auto'};">
          ${hostVaultStatusHtml}
          ${mainBoardHtml}
        </div>

        <!-- 第三欄：右側滑出抽屜 -->
        <div id="vaultDrawer" class="vault-drawer ${(state.drawerOpen && (selectedTab === 'hosts' || selectedTab === 'snippets' || selectedTab === 'integrations')) ? 'open' : ''}" style="width: 380px; background: #0c121f; border-left: 1px solid rgba(23,107,135,0.25); display: flex; flex-direction: column; transition: transform 0.3s ease; transform: ${(state.drawerOpen && (selectedTab === 'hosts' || selectedTab === 'snippets' || selectedTab === 'integrations')) ? 'translateX(0)' : 'translateX(100%)'}; position: relative;">
          ${selectedTab === 'hosts' ? (
            state.drawerOpen && state.drawerMode === 'aws-integration' ?
              this.renderAWSIntegrationForm()
            : state.drawerOpen && state.drawerMode === 'group' ?
              this.renderGroupEditForm()
            : !state.selectedHost && !state.drawerOpen ? `
              <div id="vaultEmptyState" class="vault-empty-state" style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--color-text-muted); text-align: center;">
                <div>
                  <h3 style="margin-bottom: 8px; color: var(--color-text);">${t('hostvault.hostVaultTitle')}</h3>
                  <p style="font-size: 12.5px;">${t('hostvault.emptyStateDesc')}</p>
                </div>
              </div>
            ` : `
            <div class="settings-dialog" style="width: 100% !important; height: 100% !important; max-height: 100% !important; border: none !important; box-shadow: none !important; transform: none !important; display: flex; flex-direction: column;">
              <div class="settings-header" style="padding: 16px 20px; border-bottom: 1px solid rgba(23,107,135,0.15); display: flex; justify-content: space-between; align-items: center;">
                <h2 id="modalTitle" style="font-size: 15px; font-weight: 700; color: var(--color-text);">${state.selectedHost?.id ? 'Edit Host' : 'New Host'}</h2>
                <button type="button" aria-label="${t('hostvault.closeSettings')}" id="closeVaultDrawer" class="no-drag btn-icon icon-btn" title="${t('hostvault.closeSettings')}" style="font-size: 18px;">
                  &times;
                </button>
              </div>

              <form id="settingsForm" style="display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; margin: 0;">
                <div class="settings-body" style="padding: 20px; flex: 1; overflow-y: auto;">
                  <div class="section-title" style="margin-bottom: 12px;">
                    <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase;">Address</h3>
                  </div>
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 14px;">
                    Host
                    <input class="no-drag" id="host" name="host" value="${drawerHost.config?.host || ''}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text); font-weight: 600;">
                  </label>

                  <div class="section-title" style="margin-top: 20px; margin-bottom: 12px;">
                    <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase;">General</h3>
                  </div>
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                    ${t('hostvault.connectionAlias')}
                    <input class="no-drag" id="alias" name="alias" value="${drawerHost.alias || ''}" placeholder="${t('hostvault.aliasPlaceholder')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  </label>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      Port
                      <input class="no-drag" id="port" name="port" type="number" min="1" max="65535" value="${drawerHost.config?.port || 22}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      ${t('hostvault.loginMethod')}
                      <select class="no-drag" id="authMode" name="authMode" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="password" ${drawerHost.config?.authMode === 'password' ? 'selected' : ''}>${t('hostvault.authPassword')}</option>
                        <option value="key" ${drawerHost.config?.authMode === 'key' ? 'selected' : ''}>${t('hostvault.authKey')}</option>
                      </select>
                    </label>
                  </div>

                  <div class="section-title" style="margin-top: 20px; margin-bottom: 12px;">
                    <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase;">Credentials</h3>
                  </div>
                  <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                    Username
                    <input class="no-drag" id="username" name="username" value="${drawerHost.config?.username || ''}" required style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                  </label>

                  <div id="passwordAuth" style="display: ${drawerHost.config?.authMode === 'password' ? 'block' : 'none'}; margin-top: 10px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      SSH Password
                      ${renderSecretInput(SECRET_FIELD_DEFINITIONS[0], drawerHost, `autocomplete="current-password" placeholder="${t('hostvault.secretKeepPlaceholder')}"`)}
                      ${renderSecretStatusBadge(SECRET_FIELD_DEFINITIONS[0], drawerHost)}
                    </label>
                  </div>

                  <div id="keyAuth" style="display: ${drawerHost.config?.authMode === 'key' ? 'flex' : 'none'}; flex-direction: column; gap: 12px; margin-top: 10px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      ${t('hostvault.keychainKeyField')}
                      <select class="no-drag" id="keychainKeyId" name="keychainKeyId" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="">${t('hostvault.keychainKeyUseFile')}</option>
                        ${this.keychainKeys.map(k => `<option value="${escapeHtml(k.id)}" ${drawerHost.config?.keychainKeyId === k.id ? 'selected' : ''}>${escapeHtml(k.label)} — ${escapeHtml(formatKeychainType(k))}</option>`).join('')}
                      </select>
                    </label>
                    <div id="keyFileFields" style="display: ${drawerHost.config?.keychainKeyId ? 'none' : 'flex'}; flex-direction: column; gap: 12px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      Private Key
                      <div style="display: flex; gap: 8px;">
                        <input class="no-drag" id="privateKeyPath" name="privateKeyPath" value="${drawerHost.config?.privateKeyPath || ''}" style="flex: 1; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <button type="button" id="browseKeyBtn" class="no-drag" style="background: transparent; border: 1px solid var(--color-primary); color: var(--color-primary); padding: 0 12px; border-radius: 6px; cursor: pointer;">${t('hostvault.browse')}</button>
                      </div>
                    </label>
                    </div>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      Cert
                      <div style="display: flex; gap: 8px;">
                        <input class="no-drag" id="certPath" name="certPath" value="${drawerHost.config?.certPath || ''}" style="flex: 1; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <button type="button" id="browseCertBtn" class="no-drag" style="background: transparent; border: 1px solid var(--color-primary); color: var(--color-primary); padding: 0 12px; border-radius: 6px; cursor: pointer;">${t('hostvault.browse')}</button>
                      </div>
                    </label>
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 12px;">
                      ${t('hostvault.keyPassphraseOptional')}
                      ${renderSecretInput(SECRET_FIELD_DEFINITIONS[1], drawerHost, `placeholder="${t('hostvault.secretKeepPlaceholder')}"`)}
                      ${renderSecretStatusBadge(SECRET_FIELD_DEFINITIONS[1], drawerHost)}
                    </label>
                  </div>

                  <!-- SSH Sudo 提權密碼 -->
                  <div style="margin-top: 12px; border-top: 1px dashed rgba(23,107,135,0.15); padding-top: 12px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      ${t('hostvault.sudoPasswordOptional')}
                      ${renderSecretInput(SECRET_FIELD_DEFINITIONS[2], drawerHost, `placeholder="${t('hostvault.sudoPlaceholder')}"`)}
                      ${renderSecretStatusBadge(SECRET_FIELD_DEFINITIONS[2], drawerHost)}
                    </label>
                  </div>

                  <!-- Startup Command -->
                  <div class="settings-title-panel" style="margin-top: 20px; margin-bottom: 12px; text-align: left;">
                    <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase;">Startup Command</h3>
                  </div>
                  <div id="startupCommandWrapper" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                    <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      ${t('hostvault.startupMode')}
                      <select class="no-drag" id="startupCommandMode" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="none" ${startupCommandDefaults.startupCommandMode === 'none' ? 'selected' : ''}>${t('hostvault.startupNone')}</option>
                        <option value="snippet" ${startupCommandDefaults.startupCommandMode === 'snippet' ? 'selected' : ''}>${t('hostvault.startupSnippet')}</option>
                        <option value="manual" ${startupCommandDefaults.startupCommandMode === 'manual' ? 'selected' : ''}>${t('hostvault.startupManual')}</option>
                      </select>
                    </label>
                    <label id="startupSnippetField" style="display: ${startupCommandDefaults.startupCommandMode === 'snippet' ? 'flex' : 'none'}; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      Startup Snippet
                      <select class="no-drag" id="startupSnippetSelect" style="background: #0d121f; border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
                        <option value="">${t('hostvault.selectSnippet')}</option>
                        ${startupSnippetOptions}
                      </select>
                    </label>
                    <label id="startupManualField" style="display: ${startupCommandDefaults.startupCommandMode === 'manual' ? 'flex' : 'none'}; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext);">
                      Startup Command
                      <textarea class="no-drag" id="startupCommandText" spellcheck="false" placeholder="${t('hostvault.startupCommandPlaceholder')}" style="min-height: 88px; resize: vertical; background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 10px 12px; border-radius: 6px; color: var(--color-text); font-family: monospace; line-height: 1.5;">${escapeHtml(startupCommandDefaults.startupCommandText)}</textarea>
                    </label>
                    ${allSnippets.length === 0 ? `
                      <div style="color: var(--color-text-muted); font-size: 12.5px; text-align: left; padding: 4px 0;">${t('hostvault.noSnippetHint')}</div>
                    ` : ''}
                  </div>

                  <!-- 控制面板組件自訂掛載 -->
                  <div class="settings-title-panel" style="margin-top: 20px; margin-bottom: 12px; text-align: left;">
                    <h3 style="font-size: 11px; color: var(--color-primary); font-weight: 700; text-transform: uppercase;">${t('hostvault.controlPanelMount')}</h3>
                  </div>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--color-text); cursor: pointer; text-align: left; width: 100%; min-width: 0; margin: 0 0 12px 0;">
                    <input type="checkbox" class="no-drag" id="showSnippetsInControlPanel" ${drawerHost.config?.showSnippetsInControlPanel !== false ? 'checked' : ''} style="width: 16px; height: 16px; min-height: auto; min-width: auto; flex-shrink: 0; cursor: pointer; accent-color: var(--color-primary); margin: 0;">
                    <span style="font-weight: 600;">${t('hostvault.showSnippetsInPanel')}</span>
                  </label>
                  <div id="controlPanelComponentsWrapper" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
                    ${availableComps.length === 0 ? `
                      <div style="color: var(--color-text-muted); font-size: 12.5px; text-align: left; padding: 4px 0;">${t('hostvault.noCustomComps')}</div>
                    ` : availableComps.map(comp => {
                      const isChecked = enabledCompIds.has(comp.id) ? 'checked' : '';
                      return `
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--color-text); cursor: pointer; text-align: left; width: 100%; min-width: 0; margin: 0;">
                          <input type="checkbox" class="no-drag comp-checkbox" data-comp-id="${comp.id}" ${isChecked} style="width: 16px; height: 16px; min-height: auto; min-width: auto; flex-shrink: 0; cursor: pointer; accent-color: var(--color-primary); margin: 0;">
                          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; max-width: 260px;">${comp.name}</span>
                        </label>
                      `;
                    }).join('')}
                  </div>
                </div>

                <div class="settings-footer" style="padding: 16px 20px; border-top: 1px solid rgba(23,107,135,0.15); display: flex; gap: 10px;">
                  <button type="submit" id="connectBtn" class="no-drag primary" style="flex: 1; min-height: 38px; font-weight: 700; background: var(--color-primary); border: none; border-radius: 6px; color: #fff; cursor: pointer;">Connect</button>
                  <button type="button" id="saveHostOnlyBtn" class="no-drag" style="min-height: 38px; font-weight: 700; background: transparent; border: 1px solid var(--color-primary); border-radius: 6px; color: var(--color-primary); padding: 0 16px; cursor: pointer;">Save</button>
                  ${state.selectedHost?.id ? `<button type="button" id="vaultDeleteBtn" class="no-drag" style="min-height: 38px; font-weight: 700; background: #e74c3c; border: none; border-radius: 6px; color: #fff; padding: 0 16px; cursor: pointer;">Delete</button>` : ''}
                </div>
              </form>
            </div>
          `
          ) : selectedTab === 'integrations' ? (
            this.renderAWSIntegrationForm()
          ) : selectedTab === 'snippets' ? (
            this.snippetDrawerMode === 'package' ? packageDrawerHtml : snippetDrawerHtml
          ) : ''}
        </div>
      </div>

      <!-- New Group Modal -->
      <div id="groupModal" class="modal-overlay hidden" style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 2000;">
        <div class="modal-dialog" style="width: 320px; background: #0c121f; border: 1px solid rgba(23,107,135,0.25); border-radius: 8px; padding: 20px; color: var(--color-text);">
          <h2 id="groupModalTitle" style="font-size: 14px; font-weight: 700; margin-bottom: 12px; text-align: left;">${t('hostvault.newGroup')}</h2>
          <label style="display: flex; flex-direction: column; text-align: left; gap: 6px; font-size: 12px; color: var(--color-subtext); margin-bottom: 20px;">
            ${t('hostvault.groupName')}
            <input class="no-drag" id="groupNameInput" placeholder="${t('hostvault.groupNameExample')}" style="background: var(--input-bg); border: 1px solid rgba(23,107,135,0.2); padding: 8px 12px; border-radius: 6px; color: var(--color-text);">
          </label>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" id="cancelGroupModal" class="no-drag" style="padding: 6px 14px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--color-text); border-radius: 4px; cursor: pointer;">${t('common.cancel')}</button>
            <button type="button" id="saveGroupModal" class="no-drag primary" style="padding: 6px 14px; background: var(--color-primary); border: none; color: #fff; border-radius: 4px; cursor: pointer;">${t('common.save')}</button>
          </div>
        </div>
      </div>

      <!-- Connection Progress Modal (Premium Glassmorphism Style) -->
      <div id="connectionProgressModal" class="modal-overlay hidden" style="position: fixed; inset: 0; background: rgba(12, 18, 31, 0.75); display: flex; align-items: center; justify-content: center; z-index: 99999; backdrop-filter: blur(4px); transition: all 0.25s ease;">
        <div class="modal-dialog" style="width: min(340px, 90%); background: #0c121f; border: 1px solid rgba(23,107,135,0.25); border-radius: 12px; padding: 24px; color: var(--color-text); text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6); transform: scale(1); transition: transform 0.25s ease;">
          <!-- Modern Loading Spinner -->
          <div style="display: flex; justify-content: center; margin-bottom: 20px;">
            <div id="progressSpinner" class="spinner-telemetry" style="width: 38px; height: 38px; border: 3px solid rgba(23,107,135,0.15); border-top: 3px solid var(--color-primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          </div>
          <h3 id="progressModalTitle" style="font-size: 14px; font-weight: 700; color: var(--color-text); margin: 0 0 8px 0; text-align: center; letter-spacing: 0.5px;">${t('hostvault.establishingConnection')}</h3>
          <p id="progressModalMessage" style="font-size: 12.5px; color: var(--color-text-muted); margin: 0 0 24px 0; line-height: 1.5; text-align: center;">${t('hostvault.initializingConnection')}</p>
          <div style="display: flex; justify-content: center;">
            <button type="button" id="cancelConnectionBtn" class="no-drag" style="min-height: 34px; padding: 0 20px; font-weight: 700; font-size: 11px; border: 1px solid #ef4444; color: #ef4444; background: transparent; border-radius: 6px; cursor: pointer; transition: all 0.2s; letter-spacing: 1px;">
              CANCEL
            </button>
          </div>
        </div>
      </div>

      <!-- Vault Confirm Modal -->
      <div id="vaultConfirmModal" class="modal-overlay hidden" style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 2000;">
        <div class="modal-dialog" style="width: 340px; background: #0c121f; border: 1px solid rgba(23,107,135,0.25); border-radius: 8px; padding: 20px; color: var(--color-text);">
          <h2 id="confirmModalTitle" style="font-size: 14px; font-weight: 700; margin-bottom: 12px; text-align: left;">${t('hostvault.confirmAction')}</h2>
          <p id="confirmModalMessage" style="font-size: 12.5px; color: var(--color-subtext); line-height: 1.6; margin-bottom: 20px; text-align: left;"></p>
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" id="cancelConfirmModal" class="no-drag" style="padding: 6px 14px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--color-text); border-radius: 4px; cursor: pointer;">${t('common.cancel')}</button>
            <button type="button" id="okConfirmModal" class="no-drag" style="padding: 6px 14px; background: #a13d3d; border: none; color: #fff; border-radius: 4px; cursor: pointer;">${t('common.confirm')}</button>
          </div>
        </div>
      </div>
    `;

    if (activeElementId) {
      const el = this.querySelector(`#${activeElementId}`);
      if (el) {
        el.focus();
        if (selectionStart !== null && selectionEnd !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          el.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }

    // 每次實際 render（含元件內部直接呼叫的局部互動）後同步指紋基準，
    // 使後續訂閱回呼的比對永遠對齊目前畫面，避免重複重建。
    this.lastViewFingerprint = this.getViewFingerprint();
  }

  setupListeners() {
    const state = hostStore.getState();
    const selectedTab = state.selectedTab;

    // 1. 左側子選單點擊切換
    this.querySelectorAll('.vault-menu-item').forEach(item => {
      const tabId = item.getAttribute('data-tab');
      item.addEventListener('click', () => {
        this.selectedGroup = null;
        this.selectedAWSIntegration = null;
        if (tabId === 'control-panel') {
          // 路由跳轉至控制面板，並更新 selectedTab 狀態以防殘留其他分頁狀態
          hostStore.getState().setSelectedTab('control-panel');
          window.location.hash = '#/control-panel';
        } else {
          hostStore.getState().setSelectedTab(tabId);
        }
      });
      // a11y：Enter/Space 觸發與滑鼠點擊相同的切換路徑（複用上方 click handler）
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          item.click();
        }
      });
    });

    // 2. 點選群組資料夾進入（統一處理進入與編輯，以提升相容性與阻斷冒泡）
    this.querySelectorAll('.group-folder').forEach(item => {
      const groupId = item.getAttribute('data-group-id');
      item.addEventListener('click', async (e) => {
        // 2.1. 檢查是否點選了編輯按鈕
        const editBtn = e.target.closest('.vault-group-edit-btn');
        if (editBtn) {
          e.preventDefault();
          e.stopPropagation();
          const group = hostStore.getState().groups.find(g => g.id === groupId);
          if (!group) return;

          this.selectedGroup = group;
          hostStore.getState().setDrawerMode('group');
          hostStore.getState().setSelectedHost(null);
          hostStore.getState().setDrawerOpen(true);
          return;
        }

        // 2.2. 若非點選編輯按鈕，則點選群組進入
        hostStore.getState().setActiveGroupId(groupId);
      });
      // a11y：Enter/Space 觸發與滑鼠點擊相同的進入群組路徑（複用上方 click handler；
      // 由 item 觸發 click，e.target 為卡片本身而非編輯鈕，故走進入群組分支）
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          item.click();
        }
      });
    });

    // 3. 麵包屑回退
    const breadcrumbs = this.querySelector('#vaultBreadcrumbs');
    if (breadcrumbs) {
      breadcrumbs.addEventListener('click', () => {
        hostStore.getState().setActiveGroupId(null);
      });
    }

    // 4. 新增主機觸發
    const addHostBtn = this.querySelector('#addConnection');
    if (addHostBtn) {
      addHostBtn.addEventListener('click', () => {
        hostStore.getState().setDrawerMode('host');
        hostStore.getState().setSelectedHost({ id: null });
        hostStore.getState().setDrawerOpen(true);
      });
    }

    const awsIntegrationBtn = this.querySelector('#awsIntegrationBtn');
    if (awsIntegrationBtn) {
      awsIntegrationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openAWSIntegrationDrawer(null, { selectedTab: 'integrations', closeDropdowns: true });
      });
    }

    const newIntegrationBtn = this.querySelector('#newIntegrationBtn');
    if (newIntegrationBtn) {
      newIntegrationBtn.addEventListener('click', () => {
        this.openAWSIntegrationDrawer(null, { selectedTab: 'integrations' });
      });
    }

    this.querySelectorAll('.integration-card, .vault-integration-edit-btn').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const groupId = item.getAttribute('data-integration-group-id') || item.closest('[data-integration-group-id]')?.getAttribute('data-integration-group-id');
        if (!groupId) return;
        const integration = hostStore.getState().awsIntegrations.find(entry => entry.groupId === groupId);
        if (!integration) return;
        this.openAWSIntegrationDrawer(integration, { selectedTab: 'integrations' });
      });
    });

    // 雲端同步設定展開折疊觸發
    const toggleAwsSyncSettingsBtn = this.querySelector('#toggleAwsSyncSettingsBtn');
    if (toggleAwsSyncSettingsBtn) {
      toggleAwsSyncSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.awsSyncSettingsExpanded = !this.awsSyncSettingsExpanded;
        const syncSettingsContent = this.querySelector('#awsSyncSettingsContent');
        if (syncSettingsContent) {
          syncSettingsContent.style.display = this.awsSyncSettingsExpanded ? 'flex' : 'none';
        }
        toggleAwsSyncSettingsBtn.textContent = `${t('hostvault.cloudSyncSettings')} ${this.awsSyncSettingsExpanded ? '▲' : '▼'}`;
      });
    }

    // 登入方式切換監聽器
    const awsAuthModeSelect = this.querySelector('#awsAuthMode');
    if (awsAuthModeSelect) {
      awsAuthModeSelect.addEventListener('change', () => {
        const val = awsAuthModeSelect.value;
        const passwordContainer = this.querySelector('#awsPasswordAuth');
        const keyContainer = this.querySelector('#awsKeyAuth');
        if (passwordContainer && keyContainer) {
          if (val === 'password') {
            passwordContainer.style.display = 'flex';
            keyContainer.style.display = 'none';
          } else if (val === 'key') {
            passwordContainer.style.display = 'none';
            keyContainer.style.display = 'flex';
          }
        }
      });
    }

    // 瀏覽 Private Key 檔案
    const privateKeyPathInput = this.querySelector('#awsPrivateKeyPath');
    if (privateKeyPathInput) {
      privateKeyPathInput.addEventListener('click', async () => {
        try {
          const selected = await HostAPI.selectFile(t('hostvault.selectPrivateKeyFile'), '*');
          if (selected) {
            privateKeyPathInput.value = selected;
          }
        } catch (err) {
          console.error('[TermiX] 選擇 Private Key 檔案失敗', err);
        }
      });
    }

    // 瀏覽 Cert 檔案
    const certPathInput = this.querySelector('#awsCertPath');
    if (certPathInput) {
      certPathInput.addEventListener('click', async () => {
        try {
          const selected = await HostAPI.selectFile(t('hostvault.selectPrivateKeyFile'), '*');
          if (selected) {
            certPathInput.value = selected;
          }
        } catch (err) {
          console.error('[TermiX] 選擇 Cert 檔案失敗', err);
        }
      });
    }

    // AWS 整合表單提交監聽器
    const awsForm = this.querySelector('#awsIntegrationForm');
    if (awsForm) {
      awsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const integrationName = this.querySelector('#awsIntegrationName').value.trim();
        const groupName = this.querySelector('#awsGroupName').value.trim();
        const region = this.querySelector('#awsRegion').value;
        const accessKeyId = this.querySelector('#awsAccessKeyId').value.trim();
        const secretAccessKey = this.querySelector('#awsSecretAccessKey').value;
        const importSource = this.querySelector('#awsImportSource').value;
        const ipAddressType = this.querySelector('#awsIpAddressType').value;

        const defaultPort = parseInt(this.querySelector('#awsDefaultPort').value, 10) || 22;
        const defaultUsername = this.querySelector('#awsDefaultUsername').value.trim() || 'root';
        const authMode = this.querySelector('#awsAuthMode').value;
        const privateKeyPath = this.querySelector('#awsPrivateKeyPath').value.trim();
        const certPath = this.querySelector('#awsCertPath').value.trim();
        const defaultPassword = this.querySelector('#awsDefaultPassword')?.value || '';

        if (!integrationName) {
          showToast(t('hostvault.enterObjectName'), { type: 'error' });
          return;
        }

        if (!groupName) {
          showToast(t('hostvault.enterGroupName'), { type: 'error' });
          return;
        }

        try {
          const state = hostStore.getState();
          const currentGroupId = this.querySelector('#awsCurrentGroupId')?.value.trim() || '';
          const editingIntegration = currentGroupId
            ? state.awsIntegrations.find(item => item.groupId === currentGroupId) || this.resolveSelectedAWSIntegration()
            : this.resolveSelectedAWSIntegration();

          // 1. 檢查並取得群組 ID
          let group = state.groups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
          if (!group) {
            group = await state.saveGroup({ name: groupName });
          }
          const groupId = group.id;

          // 2. 準備 AWSIntegration 物件與 secrets
          const integration = {
            groupId: groupId,
            name: integrationName,
            region: region,
            accessKeyId: accessKeyId,
            importSource: importSource,
            ipAddressType: ipAddressType,
            defaultPort: defaultPort,
            defaultUsername: defaultUsername,
            authMode: authMode,
            privateKeyPath: privateKeyPath,
            certPath: certPath
          };

          if (editingIntegration?.secretAccessKeyRef && editingIntegration.groupId !== groupId && !secretAccessKey) {
            integration.secretAccessKeyRef = editingIntegration.secretAccessKeyRef;
          }
          if (editingIntegration?.defaultPasswordRef && editingIntegration.groupId !== groupId && !defaultPassword) {
            integration.defaultPasswordRef = editingIntegration.defaultPasswordRef;
          }

          const secrets = {
            secretAccessKey: {
              ref: `aws/${groupId}/secret-access-key`,
              value: secretAccessKey,
              hasValue: Boolean(secretAccessKey),
              clear: false
            },
            defaultPassword: {
              ref: `aws/${groupId}/default-password`,
              value: defaultPassword,
              hasValue: Boolean(defaultPassword),
              clear: false
            }
          };

          // 3. 呼叫 saveAWSIntegration 儲存
          await state.saveAWSIntegration(integration, secrets, {
            previousGroupId: editingIntegration && editingIntegration.groupId !== groupId
              ? editingIntegration.groupId
              : ''
          });

          // 如果修改了群組名稱（groupId 變更），執行資料搬移與舊整合清理
          if (editingIntegration && editingIntegration.groupId !== groupId) {
            try {
              // 1. 刪除舊的 AWS 整合設定
              await state.deleteAWSIntegration(editingIntegration.groupId);

              // 2. 將原本舊群組下所有 AWS 同步主機的 groupId 批量更新為新群組 ID
              const relatedHosts = state.hosts.filter(h => h.groupId === editingIntegration.groupId && h.awsInstanceId);
              for (const host of relatedHosts) {
                const updatedHost = {
                  ...host,
                  groupId: groupId
                };
                await HostAPI.saveHost(updatedHost, {});
              }
            } catch (moveErr) {
              console.warn('[TermiX] 移轉舊群組主機或清除舊整合失敗：', moveErr);
            }
          }

          // 4. 觸發同步（立即將 AWS 上的主機抓取過來）
          try {
            await HostAPI.syncAWSIntegration(groupId);
          } catch (syncErr) {
            console.error('[TermiX] AWS 同步主機失敗：', syncErr);
            showToast(t('hostvault.awsSyncFailed', { error: syncErr.message || syncErr }), { type: 'error', title: t('hostvault.awsSyncFailedTitle') });
          }

          // 5. 關閉 Drawer
          state.setDrawerOpen(false);
          this.selectedAWSIntegration = null;

          // 6. 重新載入主機與群組，並重新整理 UI
          await state.loadFromBackend();

          showToast(t('hostvault.awsSaveSyncDone'), { type: 'success' });

        } catch (err) {
          console.error('[TermiX] AWS 整合儲存失敗：', err);
          showToast(t('hostvault.awsSaveFailed', { error: err.message || err }), { type: 'error' });
        }
      });
    }

    const awsDeleteBtn = this.querySelector('#awsDeleteBtn');
    if (awsDeleteBtn) {
      awsDeleteBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetGroupId = awsDeleteBtn.getAttribute('data-integration-group-id') || this.querySelector('#awsCurrentGroupId')?.value.trim() || '';
        if (!targetGroupId) {
          showToast(t('hostvault.awsDeleteNotFound'), { type: 'error' });
          return;
        }

        this.confirmModalCallback = async () => {
          try {
            await hostStore.getState().deleteAWSIntegration(targetGroupId);
            this.selectedAWSIntegration = null;
            this.awsSyncSettingsExpanded = false;
            hostStore.getState().setDrawerOpen(false);
            await hostStore.getState().loadFromBackend();
          } catch (err) {
            console.error('[TermiX] 刪除 AWS 整合失敗：', err);
            showToast(t('hostvault.awsDeleteFailed', { error: err.message || err }), { type: 'error' });
          }
        };

        const confirmModal = this.querySelector('#vaultConfirmModal');
        const confirmTitle = this.querySelector('#confirmModalTitle');
        const confirmMsg = this.querySelector('#confirmModalMessage');
        if (confirmTitle) confirmTitle.textContent = t('hostvault.confirmDeleteAws');
        if (confirmMsg) confirmMsg.innerHTML = t('hostvault.confirmDeleteAwsMsg');
        if (confirmModal) confirmModal.classList.remove('hidden');
      });
    }

    // 5. 編輯主機觸發
    this.querySelectorAll('.vault-card-edit-btn').forEach(btn => {
      const hostId = btn.getAttribute('data-id');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const host = state.hosts.find(h => h.id === hostId);
        if (host) {
          hostStore.getState().setDrawerMode('host');
          hostStore.getState().setSelectedHost(host);
          hostStore.getState().setDrawerOpen(true);
          hostStore.getState().refreshHostSecretStatus(hostId).catch((err) => {
            console.error('[TermiX] 重新讀取 Host secret 狀態失敗', err);
          });
        }
      });
    });

    // 6. 雙擊主機發起連線
    this.querySelectorAll('.history-item').forEach(card => {
      const hostId = card.getAttribute('data-id');
      card.addEventListener('dblclick', () => {
        const host = state.hosts.find(h => h.id === hostId);
        if (host) {
          this.connectToHost({
            hostId: host.id,
            config: host.config,
            displayConfig: host.config
          }, host.alias || host.label);
        }
      });
      // a11y：Enter/Space 觸發與雙擊相同的連線行為（複用上方 dblclick handler，
      // 透過 dispatch 合成 dblclick 事件走完全相同的路徑，避免複製連線邏輯）。
      // 若焦點在卡片內的編輯鈕上則不攔截，交由該按鈕自身處理。
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }
      });
    });

    // 6.5. 拖曳主機卡片至群組資料夾存放 (HTML5 Drag & Drop)
    this.querySelectorAll('.history-item').forEach(card => {
      const hostId = card.getAttribute('data-id');
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', hostId);
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        this.querySelectorAll('.group-folder').forEach(gf => gf.classList.remove('drag-over'));
      });
    });

    this.querySelectorAll('.group-folder').forEach(folder => {
      const groupId = folder.getAttribute('data-group-id');

      folder.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        folder.classList.add('drag-over');
      });

      folder.addEventListener('dragleave', () => {
        folder.classList.remove('drag-over');
      });

      folder.addEventListener('drop', (e) => {
        e.preventDefault();
        folder.classList.remove('drag-over');
        const hostId = e.dataTransfer.getData('text/plain');
        if (hostId) {
          const host = state.hosts.find(h => h.id === hostId);
          if (host) {
            hostStore.getState().updateHost(hostId, { groupId }).catch((err) => {
              console.error('[TermiX] 更新 Host 群組失敗', err);
              showToast(t('hostvault.updateGroupFailed', { error: err.message || err }), { type: 'error' });
            });
          }
        }
      });
    });

    // 7. 關閉 Drawer
    this.querySelectorAll('#closeVaultDrawer').forEach(btn => {
      btn.addEventListener('click', () => {
        hostStore.getState().setDrawerOpen(false);
        hostStore.getState().setSelectedHost(null);
        this.selectedGroup = null;
        this.selectedAWSIntegration = null;
        if (selectedTab === 'snippets') {
          snippetStore.getState().setSelectedSnippet(null);
          this.selectedPackage = null;
          this.snippetDrawerMode = 'snippet';
          this.currentBatchTargetGroupId = null;
          this.batchTargetsSearchQuery = "";
          this.batchTargetsSearchFocused = false;
        }
      });
    });

    // 8. 刪除主機
    const deleteBtn = this.querySelector('#vaultDeleteBtn');
    if (deleteBtn && state.selectedHost?.id) {
      deleteBtn.addEventListener('click', () => {
        const targetHost = hostStore.getState().selectedHost;
        if (!targetHost?.id) return;
        const hostAlias = targetHost.alias || targetHost.label || targetHost.config?.host || t('hostvault.thisHost');

        // 破壞性操作二次確認：走既有的通用確認彈窗，訊息含主機別名與「不可復原」提示。
        this.confirmModalCallback = async () => {
          try {
            await hostStore.getState().deleteHost(targetHost.id);
            hostStore.getState().setDrawerOpen(false);
            hostStore.getState().setSelectedHost(null);
          } catch (err) {
            showToast(t('hostvault.deleteHostFailed', { error: err.message || err }), { type: 'error' });
          }
        };

        const confirmModal = this.querySelector('#vaultConfirmModal');
        const confirmTitle = this.querySelector('#confirmModalTitle');
        const confirmMsg = this.querySelector('#confirmModalMessage');
        if (confirmTitle) confirmTitle.textContent = t('hostvault.confirmDeleteHost');
        if (confirmMsg) confirmMsg.innerHTML = t('hostvault.confirmDeleteHostMsg', { name: escapeHtml(hostAlias) });
        if (confirmModal) confirmModal.classList.remove('hidden');
      });
    }

    // 9. 登入方式 Select 切換
    const authModeSelect = this.querySelector('#authMode');
    if (authModeSelect) {
      authModeSelect.addEventListener('change', (e) => {
        const mode = e.target.value;
        const passAuthEl = this.querySelector('#passwordAuth');
        const keyAuthEl = this.querySelector('#keyAuth');
        if (passAuthEl) passAuthEl.style.display = mode === 'password' ? 'block' : 'none';
        if (keyAuthEl) keyAuthEl.style.display = mode === 'key' ? 'flex' : 'none';
      });
    }

    // 9b. 選用 Keychain 金鑰時，隱藏私鑰檔案欄位（金鑰庫金鑰優先）。
    const keychainKeySelect = this.querySelector('#keychainKeyId');
    if (keychainKeySelect) {
      keychainKeySelect.addEventListener('change', (e) => {
        const fileFields = this.querySelector('#keyFileFields');
        if (fileFields) fileFields.style.display = e.target.value ? 'none' : 'flex';
      });
    }

    const startupModeSelect = this.querySelector('#startupCommandMode');
    if (startupModeSelect) {
      startupModeSelect.addEventListener('change', (e) => {
        const mode = e.target.value;
        const snippetField = this.querySelector('#startupSnippetField');
        const manualField = this.querySelector('#startupManualField');
        if (snippetField) snippetField.style.display = mode === 'snippet' ? 'flex' : 'none';
        if (manualField) manualField.style.display = mode === 'manual' ? 'flex' : 'none';
      });
    }

    // 10. 瀏覽 Key / Cert 檔案
    const browseKeyBtn = this.querySelector('#browseKeyBtn');
    if (browseKeyBtn) {
      browseKeyBtn.addEventListener('click', async () => {
        try {
          const path = await HostAPI.selectFile(t('hostvault.selectPrivateKeyFile'), '*');
          if (path) {
            const input = this.querySelector('#privateKeyPath');
            if (input) input.value = path;
          }
        } catch (e) {
          console.error(e);
        }
      });
    }

    const browseCertBtn = this.querySelector('#browseCertBtn');
    if (browseCertBtn) {
      browseCertBtn.addEventListener('click', async () => {
        try {
          const path = await HostAPI.selectFile(t('hostvault.selectCertFile'), '*');
          if (path) {
            const input = this.querySelector('#certPath');
            if (input) input.value = path;
          }
        } catch (e) {
          console.error(e);
        }
      });
    }

    // 11. 表單提交發起連線與儲存
    const form = this.querySelector('#settingsForm');
    if (form) {
      bindSecretFieldState(this);
      bindSecretVisibilityToggles(this);

      const persistHostFromForm = async () => {
        const hostVal = this.querySelector('#host').value.trim();
        const aliasVal = this.querySelector('#alias').value.trim();
        const portVal = parseInt(this.querySelector('#port').value, 10);
        const authModeVal = this.querySelector('#authMode').value;
        const usernameVal = this.querySelector('#username').value.trim();
        const privateKeyPathVal = this.querySelector('#privateKeyPath')?.value || '';
        const keychainKeyIdVal = this.querySelector('#keychainKeyId')?.value || '';
        const certPathVal = this.querySelector('#certPath')?.value || '';
        const customComponents = collectMountedComponents(this, state.selectedHost?.config?.customComponents, getAvailableControlPanelComponents());
        const startupCommandConfig = readStartupCommandConfig(this, state.selectedHost?.config);
        const showSnippetsInControlPanel = this.querySelector('#showSnippetsInControlPanel')?.checked !== false;
        const hostId = state.selectedHost?.id || createDraftHostId();
        const secretRefs = ensureSecretRefs(hostId, state.selectedHost?.config || {});
        const config = {
          host: hostVal,
          port: portVal,
          username: usernameVal,
          authMode: authModeVal,
          privateKeyPath: privateKeyPathVal,
          keychainKeyId: keychainKeyIdVal,
          certPath: certPathVal,
          secretRefs,
          customComponents,
          showSnippetsInControlPanel,
          ...startupCommandConfig
        };
        const secretsPayload = buildSecretsPayload(this, hostId, state.selectedHost || { id: hostId, config });
        const label = aliasVal || `${usernameVal}@${hostVal}`;

        return hostStore.getState().saveHost({
          hostId,
          sourceHost: state.selectedHost || createHostProfile(hostId, {
            id: hostId,
            alias: aliasVal,
            groupId: state.activeGroupId,
            config
          }),
          overrides: {
            id: hostId,
            label,
            alias: aliasVal,
            groupId: state.selectedHost?.groupId ?? state.activeGroupId ?? null,
            config
          },
          secretsPayload
        });
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // a11y/表單驗證：submit handler 以 preventDefault 繞過原生必填提示，
        // 這裡沿用與「僅儲存」按鈕相同的原生驗證（欄位已宣告 required 與 port min/max），
        // 不合法時就地提示並中止，合法則維持原本「儲存並連線」流程不變。
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }
        try {
          const savedHost = await persistHostFromForm();
          hostStore.getState().setDrawerOpen(false);
          hostStore.getState().setSelectedHost(null);
          await this.connectToHost({
            hostId: savedHost.id,
            config: savedHost.config,
            displayConfig: savedHost.config
          }, savedHost.alias || savedHost.label);
        } catch (err) {
          showToast(t('hostvault.saveAndConnectFailed', { error: err.message || err }), { type: 'error' });
        }
      });

      // 11.5. 新增僅儲存不發起連線的按鍵監聽
      const saveHostOnlyBtn = this.querySelector('#saveHostOnlyBtn');
      if (saveHostOnlyBtn) {
        saveHostOnlyBtn.addEventListener('click', async () => {
          if (!form.checkValidity()) {
            form.reportValidity();
            return;
          }
          try {
            await persistHostFromForm();
            hostStore.getState().setDrawerOpen(false);
            hostStore.getState().setSelectedHost(null);
            showToast(t('hostvault.saveSuccess'), { type: 'success' });
          } catch (err) {
            showToast(t('hostvault.saveFailed', { error: err.message || err }), { type: 'error' });
          }
        });
      }

    }

    // 12. 頂部搜尋 CONNECT
    const searchConnectBtn = this.querySelector('#vaultSearchConnectBtn');
    if (searchConnectBtn) {
      searchConnectBtn.addEventListener('click', async () => {
        const val = this.querySelector('#vaultSearchInput').value.trim();
        if (!val) return;

        const matchedHost = findMatchingSavedHost(state.hosts, val);
        if (matchedHost) {
          this.connectToHost({
            hostId: matchedHost.id,
            config: matchedHost.config,
            displayConfig: matchedHost.config
          }, matchedHost.alias || matchedHost.label);
          return;
        }

        // 判斷是否為 user@host:port 格式
        let username = '';
        let host = val;
        let port = 22;
        let userExplicit = false;

        if (val.includes('@')) {
          const parts = val.split('@');
          username = parts[0];
          host = parts[1];
          userExplicit = parts[0].trim().length > 0;
        }

        if (host.includes(':')) {
          const parts = host.split(':');
          host = parts[0];
          port = parseInt(parts[1], 10) || 22;
        }

        // 未明確指定帳號時，預設不再靜默以 root 連線；改用 admin 並在確認框中明示。
        if (!userExplicit) {
          username = 'admin';
        }

        // 破壞性 / 高風險操作確認：找不到既有主機時，連線前顯示解析後的 user@host:port，
        // 讓使用者明確看到將以哪個帳號連線到哪台主機（含未指定帳號時的預設值）。
        const resolvedTarget = `${username}@${host}:${port}`;
        const extraNote = userExplicit
          ? ''
          : t('hostvault.noSavedHostNote');
        if (!(await confirmDialog(t('hostvault.noSavedHostConfirm', { target: resolvedTarget, note: extraNote }), { title: t('hostvault.confirmNewConnection') }))) {
          return;
        }

        const config = {
          host,
          port,
          username,
          authMode: 'password'
        };

        this.connectToHost({ config, displayConfig: config }, `${username}@${host}`);
      });
    }

    // 搜尋輸入框 binding
    const searchInput = this.querySelector('#vaultSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        hostStore.getState().setSearchQuery(e.target.value);
      });
    }

    // 13. 新增群組彈窗
    const addGroupBtn = this.querySelector('#addGroupBtn');
    if (addGroupBtn) {
      addGroupBtn.addEventListener('click', () => {
        const modal = this.querySelector('#groupModal');
        const title = this.querySelector('#groupModalTitle');
        const input = this.querySelector('#groupNameInput');
        this.groupModalMode = 'create';
        this.groupModalTargetGroupId = null;
        if (title) title.textContent = t('hostvault.newGroup');
        if (modal) {
          if (input) input.value = '';
          modal.classList.remove('hidden');
          if (input) input.focus();
        }
      });
    }

    const groupNameInput = this.querySelector('#groupNameInput');
    if (groupNameInput) {
      groupNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const saveBtn = this.querySelector('#saveGroupModal');
          if (saveBtn) saveBtn.click();
        }
      });
    }

    const cancelGroupBtn = this.querySelector('#cancelGroupModal');
    if (cancelGroupBtn) {
      cancelGroupBtn.addEventListener('click', () => {
        const modal = this.querySelector('#groupModal');
        if (modal) modal.classList.add('hidden');
      });
    }

    const saveGroupBtn = this.querySelector('#saveGroupModal');
    if (saveGroupBtn) {
      saveGroupBtn.addEventListener('click', async () => {
        const input = this.querySelector('#groupNameInput');
        const name = input ? input.value.trim() : '';
        if (!name) {
          showToast(t('hostvault.groupNameEmpty'), { type: 'error' });
          return;
        }
        try {
          await hostStore.getState().addGroup({
            id: `g_${Date.now().toString(36)}`,
            name
          });
          const modal = this.querySelector('#groupModal');
          if (modal) modal.classList.add('hidden');
        } catch (err) {
          showToast(t('hostvault.createGroupFailed', { error: err.message || err }), { type: 'error' });
        }
      });
    }

    // 繫結通用確認彈窗事件
    const cancelConfirmBtn = this.querySelector('#cancelConfirmModal');
    if (cancelConfirmBtn) {
      cancelConfirmBtn.addEventListener('click', () => {
        const confirmModal = this.querySelector('#vaultConfirmModal');
        if (confirmModal) confirmModal.classList.add('hidden');
        this.confirmModalCallback = null;
      });
    }

    const okConfirmBtn = this.querySelector('#okConfirmModal');
    if (okConfirmBtn) {
      okConfirmBtn.addEventListener('click', async () => {
        const confirmModal = this.querySelector('#vaultConfirmModal');
        if (confirmModal) confirmModal.classList.add('hidden');
        if (this.confirmModalCallback) {
          await this.confirmModalCallback();
        }
        this.confirmModalCallback = null;
      });
    }

    const manageGroupAwsBtn = this.querySelector('#manageGroupAwsBtn');
    if (manageGroupAwsBtn && this.selectedGroup?.id) {
      manageGroupAwsBtn.addEventListener('click', () => {
        const integration = hostStore.getState().awsIntegrations.find(item => item.groupId === this.selectedGroup.id) || null;
        this.openAWSIntegrationDrawer(integration, { selectedTab: 'integrations' });
      });
    }

    // 14. 編輯群組 Drawer 表單提交與刪除
    const groupEditForm = this.querySelector('#groupEditForm');
    if (groupEditForm) {
      groupEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const input = this.querySelector('#groupDrawerNameInput');
        const name = input ? input.value.trim() : '';
        if (!name) {
          showToast(t('hostvault.groupNameEmpty'), { type: 'error' });
          return;
        }

        if (this.selectedGroup) {
          const groupId = this.selectedGroup.id;
          const state = hostStore.getState();

          try {
            await state.updateGroup(groupId, { name });
            await state.loadFromBackend();
            state.setDrawerOpen(false);
            this.selectedGroup = null;
          } catch (err) {
            console.error('更新群組失敗：', err);
            showToast(t('hostvault.updateGroupFailed', { error: err.message }), { type: 'error' });
          }
        }
      });
    }

    const groupDeleteBtn = this.querySelector('#vaultGroupDeleteBtn');
    if (groupDeleteBtn && this.selectedGroup) {
      const groupId = this.selectedGroup.id;
      groupDeleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const groupHosts = hostStore.getState().hosts.filter(h => h.groupId === groupId);
        const count = groupHosts.length;

        let message = '';
        if (count > 0) {
          message = t('hostvault.groupHasHostsMsg', { count });
        } else {
          message = t('hostvault.confirmDeleteEmptyGroup');
        }

        this.confirmModalCallback = async () => {
          try {
            if (count > 0) {
              for (const host of groupHosts) {
                await hostStore.getState().deleteHost(host.id);
              }
            }
            await hostStore.getState().deleteGroup(groupId);
            hostStore.getState().setDrawerOpen(false);
            this.selectedGroup = null;
          } catch (err) {
            console.error('刪除群組失敗：', err);
            showToast(t('hostvault.deleteGroupFailed', { error: err.message }), { type: 'error' });
          }
        };

        const confirmModal = this.querySelector('#vaultConfirmModal');
        const confirmTitle = this.querySelector('#confirmModalTitle');
        const confirmMsg = this.querySelector('#confirmModalMessage');
        if (confirmTitle) confirmTitle.textContent = t('hostvault.confirmDeleteGroup');
        if (confirmMsg) confirmMsg.innerHTML = message.replace(/\n/g, '<br>');
        if (confirmModal) confirmModal.classList.remove('hidden');
      });
    }


    if (selectedTab === 'snippets') {
      const setCurrentSnippet = (snippet) => {
        this.snippetDrawerMode = 'snippet';
        this.selectedPackage = null;
        snippetStore.getState().setSelectedSnippet(snippet);
        this.currentBatchTargetGroupId = null;
        this.batchTargetsSearchQuery = "";
        this.batchTargetsSearchFocused = false;
        if (snippet) {
          hostStore.getState().setDrawerOpen(true);
        } else {
          hostStore.getState().setDrawerOpen(false);
        }
        this.render();
        this.setupListeners();
      };

      const setCurrentPackage = (pkg) => {
        this.snippetDrawerMode = 'package';
        this.selectedPackage = pkg || { id: '', name: '' };
        this.currentBatchTargetGroupId = null;
        this.batchTargetsSearchQuery = "";
        this.batchTargetsSearchFocused = false;
        hostStore.getState().setDrawerOpen(true);
        this.render();
        this.setupListeners();
      };

      const readSnippetForm = () => {
        const current = snippetStore.getState().selectedSnippet || {};
        let targetHostIds = current.targetHostIds || [];

        const domHostCheckboxes = this.querySelectorAll('.snippet-target-checkbox');
        if (domHostCheckboxes.length > 0) {
          const visibleHostIds = Array.from(domHostCheckboxes).map(cb => cb.getAttribute('data-host-id'));
          const checkedHostIds = Array.from(domHostCheckboxes).filter(cb => cb.checked).map(cb => cb.getAttribute('data-host-id'));
          const otherHostIds = targetHostIds.filter(id => !visibleHostIds.includes(id));
          targetHostIds = [...otherHostIds, ...checkedHostIds];
        }

        return {
          ...current,
          name: this.querySelector('#snippetNameInput')?.value.trim() || 'Untitled Snippet',
          packageId: this.querySelector('#snippetPackageSelect')?.value || '',
          description: this.querySelector('#snippetDescriptionInput')?.value.trim() || '',
          script: this.querySelector('#snippetScriptInput')?.value || '',
          targetHostIds
        };
      };

      const newSnippetBtn = this.querySelector('#newSnippetBtn');
      if (newSnippetBtn) {
        newSnippetBtn.addEventListener('click', () => setCurrentSnippet({
          id: '',
          name: '',
          description: '',
          script: '',
          packageId: '',
          targetHostIds: []
        }));
      }

      const newPackageBtn = this.querySelector('#newSnippetPackageBtn');
      if (newPackageBtn) {
        newPackageBtn.addEventListener('click', () => {
          setCurrentPackage({ id: '', name: '' });
        });
      }

      const packageForm = this.querySelector('#snippetPackageForm');
      if (packageForm) {
        packageForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const name = this.querySelector('#snippetPackageNameInput')?.value.trim() || '';
          if (!name) return;
          if (this.selectedPackage?.id) {
            this.selectedPackage = snippetStore.getState().updatePackage(this.selectedPackage.id, { name });
          } else {
            this.selectedPackage = snippetStore.getState().addPackage(name);
          }
          hostStore.getState().setDrawerOpen(false);
          this.render();
          this.setupListeners();
        });
      }

      const deletePackageBtn = this.querySelector('#deleteSnippetPackageBtn');
      if (deletePackageBtn) {
        deletePackageBtn.addEventListener('click', async () => {
          const currentPackage = this.selectedPackage?.id
            ? snippetStore.getState().packages.find((pkg) => pkg.id === this.selectedPackage.id)
            : null;
          if (!currentPackage) return;
          if (!(await confirmDialog(t('hostvault.confirmDeletePackage', { name: currentPackage.name }), { title: t('hostvault.confirmDeletePackageTitle'), danger: true }))) return;
          snippetStore.getState().deletePackage(currentPackage.id);
          if (this.activePackageId === currentPackage.id) this.activePackageId = 'all';
          const currentSnippet = snippetStore.getState().selectedSnippet;
          if (currentSnippet?.packageId === currentPackage.id) {
            snippetStore.getState().setSelectedSnippet({ ...currentSnippet, packageId: '' });
          }
          this.selectedPackage = null;
          hostStore.getState().setDrawerOpen(false);
          this.render();
          this.setupListeners();
        });
      }

      this.querySelectorAll('.snippet-package-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const packageId = btn.getAttribute('data-package-id');
          const currentPackage = snippetStore.getState().packages.find((pkg) => pkg.id === packageId);
          if (!currentPackage) return;
          setCurrentPackage(currentPackage);
        });
      });

      this.querySelectorAll('.snippet-card').forEach(card => {
        const snippetId = card.getAttribute('data-snippet-id');
        card.addEventListener('click', () => {
          const snippet = snippetStore.getState().snippets.find(item => item.id === snippetId);
          if (snippet) setCurrentSnippet(snippet);
        });
        card.addEventListener('dblclick', async () => {
          const snippet = snippetStore.getState().snippets.find(item => item.id === snippetId);
          if (snippet && (await confirmDialog(t('hostvault.confirmRunSnippet', { name: snippet.name }), { title: t('hostvault.confirmRunSnippetTitle') }))) {
            this.runSnippetOnActiveSession(snippet);
          }
        });
      });

      const saveSnippetBtn = this.querySelector('#saveSnippetBtn');
      if (saveSnippetBtn) {
        saveSnippetBtn.addEventListener('click', () => {
          const snippet = snippetStore.getState().upsertSnippet(readSnippetForm());
          setCurrentSnippet(snippet);
        });
      }

      const deleteSnippetBtn = this.querySelector('#deleteSnippetBtn');
      if (deleteSnippetBtn) {
        deleteSnippetBtn.addEventListener('click', () => {
          const current = snippetStore.getState().selectedSnippet;
          if (!current?.id) return;
          snippetStore.getState().deleteSnippet(current.id);
          setCurrentSnippet(null);
        });
      }

      // 點選 Package 卡片進入分類
      this.querySelectorAll('.package-folder').forEach(folder => {
        folder.addEventListener('click', (e) => {
          if (e.target.closest('.snippet-package-edit-btn')) return;
          const packageId = folder.getAttribute('data-package-id');
          this.activePackageId = packageId;
          this.render();
          this.setupListeners();
        });
      });

      // 麵包屑回退
      const snippetBreadcrumbs = this.querySelector('#snippetBreadcrumbs');
      if (snippetBreadcrumbs) {
        snippetBreadcrumbs.addEventListener('click', () => {
          this.activePackageId = 'all';
          this.render();
          this.setupListeners();
        });
      }

      // Snippet 卡片拖曳監聽
      this.querySelectorAll('.snippet-card').forEach(card => {
        const snippetId = card.getAttribute('data-snippet-id');
        card.addEventListener('dragstart', (e) => {
          card.classList.add('dragging');
          e.dataTransfer.setData('text/plain', snippetId);
          e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          this.querySelectorAll('.package-folder').forEach(ch => ch.classList.remove('drag-over'));
        });
      });

      // Package 卡片拖曳放開事件監聽
      this.querySelectorAll('.package-folder').forEach(folder => {
        const packageId = folder.getAttribute('data-package-id');

        folder.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          folder.classList.add('drag-over');
        });

        folder.addEventListener('dragleave', () => {
          folder.classList.remove('drag-over');
        });

        folder.addEventListener('drop', (e) => {
          e.preventDefault();
          folder.classList.remove('drag-over');
          const snippetId = e.dataTransfer.getData('text/plain');
          if (snippetId) {
            const snippet = snippetStore.getState().snippets.find(s => s.id === snippetId);
            if (snippet) {
              const targetPackageId = packageId === 'all' ? '' : packageId;
              snippetStore.getState().upsertSnippet({
                ...snippet,
                packageId: targetPackageId
              });
            }
          }
        });
      });

      const runTargetsBtn = this.querySelector('#runSnippetTargetsBtn');
      if (runTargetsBtn) {
        runTargetsBtn.addEventListener('click', async () => {
          const current = snippetStore.getState().upsertSnippet(readSnippetForm());
          const targets = state.hosts.filter(host => current.targetHostIds.includes(host.id));
          await this.runSnippetOnHosts(current, targets);
        });
      }

      this.querySelectorAll('.snippet-run-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const snippet = snippetStore.getState().snippets.find(item => item.id === btn.getAttribute('data-snippet-id'));
          if (snippet) await this.runSnippetOnActiveSession(snippet);
        });
      });

      this.querySelectorAll('.snippet-paste-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const snippet = snippetStore.getState().snippets.find(item => item.id === btn.getAttribute('data-snippet-id'));
          if (snippet) await this.pasteSnippetOnActiveSession(snippet);
        });
      });

      // A. 搜尋框監聽與防焦點遺失
      const searchInput = this.querySelector('#batchTargetsSearchInput');
      if (searchInput) {
        searchInput.value = this.batchTargetsSearchQuery || '';

        if (this.batchTargetsSearchFocused) {
          searchInput.focus();
          const len = searchInput.value.length;
          searchInput.setSelectionRange(len, len);
        }

        searchInput.addEventListener('focus', () => {
          this.batchTargetsSearchFocused = true;
        });
        searchInput.addEventListener('blur', () => {
          this.batchTargetsSearchFocused = false;
        });

        searchInput.addEventListener('input', () => {
          this.batchTargetsSearchQuery = searchInput.value.trim();

          const currentForm = readSnippetForm();
          snippetStore.getState().setSelectedSnippet(currentForm);

          this.render();
          this.setupListeners();
        });
      }

      // B. 點擊群組行進入群組
      this.querySelectorAll('.batch-group-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('input[type="checkbox"]')) return;
          const groupId = row.getAttribute('data-group-id');
          const currentForm = readSnippetForm();
          snippetStore.getState().setSelectedSnippet(currentForm);

          this.currentBatchTargetGroupId = groupId;
          this.batchTargetsSearchQuery = ""; // 進入群組時清空搜尋
          this.render();
          this.setupListeners();
        });
      });

      // C. 群組 checkbox 點擊 (全選與全取消連動)
      this.querySelectorAll('.snippet-group-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const groupId = cb.getAttribute('data-group-id');
          const isChecked = cb.checked;
          const currentForm = readSnippetForm();

          let groupHostIds = [];
          if (groupId === 'ungrouped') {
            groupHostIds = state.hosts.filter(h => !h.groupId).map(h => h.id);
          } else {
            groupHostIds = state.hosts.filter(h => h.groupId === groupId).map(h => h.id);
          }

          let newTargetHostIds = currentForm.targetHostIds || [];
          if (isChecked) {
            groupHostIds.forEach(id => {
              if (!newTargetHostIds.includes(id)) {
                newTargetHostIds.push(id);
              }
            });
          } else {
            newTargetHostIds = newTargetHostIds.filter(id => !groupHostIds.includes(id));
          }

          snippetStore.getState().setSelectedSnippet({
            ...currentForm,
            targetHostIds: newTargetHostIds
          });

          this.render();
          this.setupListeners();
        });
      });

      // D. 返回群組列表按鈕
      const backBtn = this.querySelector('#backToGroupListBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          const currentForm = readSnippetForm();
          snippetStore.getState().setSelectedSnippet(currentForm);

          this.currentBatchTargetGroupId = null;
          this.render();
          this.setupListeners();
        });
      }

      // E. 設定群組 checkbox 半選狀態
      this.querySelectorAll('.snippet-group-checkbox[data-indeterminate="true"]').forEach(cb => {
        cb.indeterminate = true;
      });

      // F. 切換顯示全部/顯示未分類的 Snippets
      const toggleShowAllBtn = this.querySelector('#toggleShowAllSnippetsBtn');
      if (toggleShowAllBtn) {
        toggleShowAllBtn.addEventListener('click', () => {
          this.showAllSnippets = !this.showAllSnippets;
          this.render();
          this.setupListeners();
        });
      }
    }

    // 14. 系統日誌 Tab 事件繫結
    if (selectedTab === 'logs') {
      const selectAllBtn = this.querySelector('#selectAllLogsBtn');
      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
          const boxes = Array.from(this.querySelectorAll('.log-select-checkbox'));
          const shouldSelect = boxes.some(cb => !cb.checked);
          boxes.forEach(cb => {
            cb.checked = shouldSelect;
          });
          selectAllBtn.textContent = shouldSelect ? t('hostvault.deselectAll') : t('hostvault.selectAll');
        });
      }

      const deleteSelectedBtn = this.querySelector('#deleteSelectedLogsBtn');
      if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', () => {
          const selectedIds = Array.from(this.querySelectorAll('.log-select-checkbox'))
            .filter(cb => cb.checked)
            .map(cb => cb.getAttribute('data-log-id'))
            .filter(Boolean);
          if (selectedIds.length === 0) return;
          deleteSessionLogs(selectedIds);
          this.render();
          this.setupListeners();
        });
      }

      const clearBtn = this.querySelector('#clearGlobalLogsBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          clearSessionLogs(terminalStore.getState().sessions);
          this.render();
          this.setupListeners();
        });
      }

      this.querySelectorAll('.log-record-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('button, input')) return;
          const logId = row.getAttribute('data-log-id');
          const logs = readSessionLogs();
          const record = logs.find(l => l.id === logId);
          if (record) {
            this.openReadOnlyLogSession(record);
          }
        });
      });
    }

    // 15. Keychain Tab 事件繫結
    if (selectedTab === 'keychain') {
      // 首次進入分頁時載入後端金鑰清單。
      if (!this.keychainLoaded && !this.keychainLoading) {
        this.loadKeychainKeys();
      }

      const generateBtn = this.querySelector('#generateKeyBtn');
      if (generateBtn) {
        generateBtn.addEventListener('click', () => this.handleKeychainCreate('generate'));
      }
      const importBtn = this.querySelector('#importKeyBtn');
      if (importBtn) {
        importBtn.addEventListener('click', () => this.handleKeychainCreate('import'));
      }

      this.querySelectorAll('.copy-pubkey-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const key = this.keychainKeys.find(k => k.id === btn.getAttribute('data-id'));
          if (!key) return;
          try {
            await navigator.clipboard?.writeText(key.publicKey || '');
            showToast(t('hostvault.keychainCopied'), { type: 'success' });
          } catch (err) {
            showToast(t('hostvault.keychainSaveFailed', { error: err.message || err }), { type: 'error' });
          }
        });
      });

      this.querySelectorAll('.delete-key-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const keyId = btn.getAttribute('data-id');
          if (await confirmDialog(t('hostvault.confirmDeleteKey'), { title: t('hostvault.confirmDeleteKeyTitle'), danger: true })) {
            try {
              await KeychainAPI.deleteKey(keyId);
              showToast(t('hostvault.keychainDeleted'), { type: 'success' });
              this.loadKeychainKeys(true);
            } catch (err) {
              showToast(t('hostvault.keychainSaveFailed', { error: err.message || err }), { type: 'error' });
            }
          }
        });
      });
    }

    // 16. Known Hosts Tab 事件繫結
    if (selectedTab === 'known_hosts') {
      // 首次進入分頁時載入後端 known_hosts 清單。
      if (!this.knownHostsLoaded && !this.knownHostsLoading) {
        this.loadKnownHosts();
      }

      this.querySelectorAll('.delete-kh-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const entry = this.knownHosts[Number(btn.getAttribute('data-index'))];
          if (!entry) return;
          if (await confirmDialog(t('hostvault.confirmRevokeTrust'), { title: t('hostvault.confirmRevokeTrustTitle'), danger: true })) {
            try {
              await HostAPI.removeKnownHost(entry.host, 0);
              showToast(t('hostvault.knownHostRemoved', { host: entry.host }), { type: 'success' });
              await this.loadKnownHosts(true);
            } catch (err) {
              showToast(t('hostvault.knownHostRemoveFailed', { error: err.message || err }), { type: 'error' });
            }
          }
        });
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

    const serializeHostForExport = (host, mode) => {
      const normalizedHost = createHostProfile(host.id, host, {});
      const secretRefs = normalizedHost.config?.secretRefs || {};
      const exportConfig = {
        host: normalizedHost.config?.host || '',
        port: normalizedHost.config?.port || 22,
        username: normalizedHost.config?.username || '',
        authMode: normalizedHost.config?.authMode || 'password',
        privateKeyPath: normalizedHost.config?.privateKeyPath || '',
        certPath: normalizedHost.config?.certPath || '',
        customComponents: normalizedHost.config?.customComponents || [],
        showSnippetsInControlPanel: normalizedHost.config?.showSnippetsInControlPanel !== false,
        startupSnippetIds: normalizedHost.config?.startupSnippetIds || [],
        startupCommandMode: normalizedHost.config?.startupCommandMode || 'none',
        startupSnippetId: normalizedHost.config?.startupSnippetId || '',
        startupCommandText: normalizedHost.config?.startupCommandText || ''
      };

      if (mode === 'reference') {
        const secret = {};
        if (secretRefs.sshPasswordRef) secret.sshPasswordRef = secretRefs.sshPasswordRef;
        if (secretRefs.keyPassphraseRef) secret.keyPassphraseRef = secretRefs.keyPassphraseRef;
        if (secretRefs.sudoPasswordRef) secret.sudoPasswordRef = secretRefs.sudoPasswordRef;
        if (Object.keys(secret).length > 0) {
          exportConfig.secret = secret;
        }
      }

      return {
        id: normalizedHost.id,
        label: normalizedHost.label,
        alias: normalizedHost.alias,
        groupId: normalizedHost.groupId,
        config: exportConfig
      };
    };

    const normalizeImportedHostEntry = (rawHost, importMode) => {
      const incoming = rawHost && typeof rawHost === 'object' ? rawHost : {};
      const hostId = incoming.id || createDraftHostId();
      const rawConfig = incoming.config || {};
      const secretObject = rawConfig.secret || {};
      const derivedRefs = ensureSecretRefs(hostId, {
        ...rawConfig,
        secretRefs: {
          sshPasswordRef: secretObject.sshPasswordRef || secretObject.sshPassword?.ref || rawConfig.secretRefs?.sshPasswordRef || '',
          keyPassphraseRef: secretObject.keyPassphraseRef || secretObject.keyPassphrase?.ref || rawConfig.secretRefs?.keyPassphraseRef || '',
          sudoPasswordRef: secretObject.sudoPasswordRef || secretObject.sudoPassword?.ref || rawConfig.secretRefs?.sudoPasswordRef || ''
        },
        password: rawConfig.password || '',
        sudoPassword: rawConfig.sudoPassword || '',
        keyPassphrase: secretObject.keyPassphrase?.value || rawConfig.keyPassphrase || ''
      });

      const persistedConfig = {
        host: rawConfig.host || '',
        port: rawConfig.port || 22,
        username: rawConfig.username || '',
        authMode: rawConfig.authMode || 'password',
        privateKeyPath: rawConfig.privateKeyPath || '',
        certPath: rawConfig.certPath || '',
        customComponents: rawConfig.customComponents || [],
        showSnippetsInControlPanel: rawConfig.showSnippetsInControlPanel !== false,
        startupSnippetIds: rawConfig.startupSnippetIds || [],
        startupCommandMode: rawConfig.startupCommandMode || 'none',
        startupSnippetId: rawConfig.startupSnippetId || '',
        startupCommandText: rawConfig.startupCommandText || '',
        secretRefs: importMode === 'config-only' ? {} : derivedRefs
      };

      const secretValues = {
        sshPassword: secretObject.sshPassword?.value || rawConfig.password || '',
        keyPassphrase: secretObject.keyPassphrase?.value || rawConfig.keyPassphrase || '',
        sudoPassword: secretObject.sudoPassword?.value || rawConfig.sudoPassword || ''
      };

      const secretsPayload = {};
      if (importMode === 'reference+secret') {
        SECRET_FIELD_DEFINITIONS.forEach((field) => {
          const value = secretValues[field.key] || '';
          if (value) {
            secretsPayload[field.key] = {
              action: 'set',
              value,
              ref: derivedRefs[field.refKey],
              hasValue: true,
              clear: false
            };
          } else if (derivedRefs[field.refKey]) {
            secretsPayload[field.key] = {
              action: 'preserve',
              ref: derivedRefs[field.refKey],
              hasValue: false,
              clear: false
            };
          }
        });
      } else if (importMode === 'reference-only') {
        SECRET_FIELD_DEFINITIONS.forEach((field) => {
          if (derivedRefs[field.refKey]) {
            secretsPayload[field.key] = {
              action: 'preserve',
              ref: derivedRefs[field.refKey],
              hasValue: false,
              clear: false
            };
          }
        });
      }

      return {
        hostId,
        hostProfile: createHostProfile(hostId, {
          ...incoming,
          id: hostId,
          alias: incoming.alias || '',
          groupId: incoming.groupId || null,
          config: persistedConfig
        }),
        secretsPayload
      };
    };

    const performExport = async (format) => {
      try {
        const mode = await promptExportMode();
        if (!mode) return;

        if (!['safe', 'reference', 'full'].includes(mode)) {
          throw new Error(t('hostvault.unsupportedExportMode'));
        }

        if (mode === 'full') {
          if (!(await confirmDialog(t('hostvault.fullExportConfirm'), { title: t('hostvault.fullExportConfirmTitle'), danger: true }))) {
            return;
          }
          const exportData = await HostAPI.exportHostsBackup({ format: 'json', mode: 'full' });
          const res = await HostAPI.saveBackupFile(
            `termix-hosts-backup-full-${new Date().toISOString().slice(0, 10)}`,
            exportData,
            format
          );
          if (res && res.success) {
            showToast(t('hostvault.fullBackupExported'), { type: 'success', title: t('hostvault.exportSuccessTitle') });
            return;
          }
          throw new Error(res?.error || t('hostvault.unknownError'));
        }

        const currentState = hostStore.getState();
        const exportData = {
          hosts: currentState.hosts.map(host => serializeHostForExport(host, mode)),
          groups: currentState.groups,
          snippets: snippetStore.getState().snippets,
          snippetPackages: snippetStore.getState().packages
        };
        const jsonStr = JSON.stringify(exportData, null, 2);
        const res = await HostAPI.saveBackupFile(
          `termix-hosts-backup-${new Date().toISOString().slice(0, 10)}`,
          jsonStr,
          format
        );
        if (res && res.success) {
          showToast(t('hostvault.hostConfigExported'), { type: 'success', title: t('hostvault.exportSuccessTitle') });
          return;
        }
        throw new Error(res?.error || t('hostvault.unknownError'));
      } catch (err) {
        showToast(t('hostvault.exportFailed', { error: err.message }), { type: 'error' });
      }
    };

    const performImport = async (format) => {
      try {
        const importMode = await promptImportMode();
        if (!importMode) return;
        if (!['config-only', 'reference-only', 'reference+secret'].includes(importMode)) {
          throw new Error(t('hostvault.unsupportedImportMode'));
        }

        const res = await HostAPI.readBackupFile(format);
        if (!res || !res.success) {
          showToast(t('hostvault.readBackupFailed', { error: res ? res.error : t('hostvault.unknownError') }), { type: 'error' });
          return;
        }

        const data = JSON.parse(res.output);
        if (!data || !data.hosts) {
          showToast(t('hostvault.invalidBackupFormat'), { type: 'error' });
          return;
        }

        if (!(await confirmDialog(t('hostvault.importMergeConfirm'), { title: t('hostvault.confirmImport') }))) {
          return;
        }

        const importResult = await HostAPI.importHostsBackup(res.output, { format, mode: importMode });
        const mergedSnippets = [...snippetStore.getState().snippets];
        (data.snippets || []).forEach(newSnippet => {
          const idx = mergedSnippets.findIndex(item => item.id === newSnippet.id);
          if (idx >= 0) {
            mergedSnippets[idx] = newSnippet;
          } else {
            mergedSnippets.push(newSnippet);
          }
        });

        const mergedPackages = [...snippetStore.getState().packages];
        (data.snippetPackages || []).forEach(newPackage => {
          const idx = mergedPackages.findIndex(item => item.id === newPackage.id);
          if (idx >= 0) {
            mergedPackages[idx] = newPackage;
          } else {
            mergedPackages.push(newPackage);
          }
        });

        snippetStore.getState().setSnippets(mergedSnippets);
        snippetStore.getState().setPackages(mergedPackages);

        showToast(t('hostvault.importSuccess', { hosts: importResult?.hostsImported ?? 0, groups: importResult?.groupsImported ?? 0, secrets: importResult?.secretsWritten ?? 0 }), { type: 'success', title: t('hostvault.importSuccessTitle') });
        await hostStore.getState().refreshHosts();
      } catch (err) {
        showToast(t('hostvault.importFailed', { error: err.message }), { type: 'error' });
      }
    };

    // 17. 備份設定匯出 JSON/YAML
    const exportJsonBtn = this.querySelector('#exportHostsJsonBtn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        performExport('json');
      });
    }
    const exportYamlBtn = this.querySelector('#exportHostsYamlBtn');
    if (exportYamlBtn) {
      exportYamlBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        performExport('yaml');
      });
    }

    // 18. 備份設定匯入 JSON/YAML
    const importJsonBtn = this.querySelector('#importHostsJsonBtn');
    if (importJsonBtn) {
      importJsonBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        performImport('json');
      });
    }
    const importYamlBtn = this.querySelector('#importHostsYamlBtn');
    if (importYamlBtn) {
      importYamlBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        performImport('yaml');
      });
    }
  }

  setupGlobalDelegation() {
    this.addEventListener('click', async (e) => {
      // 點選空白處自動將 Edit Host 隱藏回去
      const state = hostStore.getState();
      if (state.drawerOpen) {
        const isClickedOutside = !e.target.closest('#vaultDrawer') &&
                                 !e.target.closest('#addConnection') &&
                                 !e.target.closest('#newIntegrationBtn') &&
                                 !e.target.closest('#awsIntegrationBtn') &&
                                 !e.target.closest('.integration-card') &&
                                 !e.target.closest('.vault-integration-edit-btn') &&
                                 !e.target.closest('.vault-card-edit-btn') &&
                                 !e.target.closest('.vault-group-edit-btn') &&
                                 !e.target.closest('#manageGroupAwsBtn') &&
                                 !e.target.closest('#newSnippetBtn') &&
                                 !e.target.closest('#newSnippetPackageBtn') &&
                                 !e.target.closest('.snippet-package-edit-btn') &&
                                 !e.target.closest('.snippet-card');
        if (isClickedOutside) {
          hostStore.getState().setDrawerOpen(false);
          hostStore.getState().setSelectedHost(null);
          this.selectedGroup = null;
          this.selectedAWSIntegration = null;
          if (state.selectedTab === 'snippets') {
            snippetStore.getState().setSelectedSnippet(null);
            this.selectedPackage = null;
            this.snippetDrawerMode = 'snippet';
            this.currentBatchTargetGroupId = null;
            this.batchTargetsSearchQuery = "";
            this.batchTargetsSearchFocused = false;
          }
        }
      }

      const cancelBtn = e.target.closest('#cancelConnectionBtn');
      if (cancelBtn) {
        e.preventDefault();
        const btnText = cancelBtn.textContent.trim();

        if (btnText === 'CLOSE') {
          const liveModal = this.querySelector('#connectionProgressModal');
          if (liveModal) liveModal.classList.add('hidden');
          return;
        }

        if (btnText === 'CANCEL') {
          // 清除可能存在的連線逾時定時器
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          cancelBtn.textContent = 'CANCELING...';
          cancelBtn.disabled = true;
          cancelBtn.style.opacity = '0.6';

          const liveMessage = this.querySelector('#progressModalMessage');
          if (liveMessage) liveMessage.textContent = t('hostvault.sendingDisconnect');

          if (this.activeConnectionTarget) {
            try {
              await TerminalAPI.cancelConnectTarget(this.activeConnectionTarget);
            } catch (err) {
              console.error('[TermiX] Failed to cancel connection', err);
            }
          }
        }
      }
    });
  }

  async runSnippetOnActiveSession(snippet) {
    const activeKey = terminalStore.getState().activePaneSessionKey;
    if (!activeKey) {
      showToast(t('hostvault.noActiveSession'), { type: 'error' });
      return;
    }
    const res = await runSnippetInSession(activeKey, snippet);
    if (!res.success) {
      showToast(t('hostvault.snippetRunFailed', { error: res.error || t('hostvault.unknownError') }), { type: 'error' });
    }
  }

  async pasteSnippetOnActiveSession(snippet) {
    const activeKey = terminalStore.getState().activePaneSessionKey;
    if (!activeKey) {
      showToast(t('hostvault.noActiveSession'), { type: 'error' });
      return;
    }
    const res = await pasteSnippetToSession(activeKey, snippet);
    if (!res.success) {
      showToast(t('hostvault.snippetPasteFailed', { error: res.error || t('hostvault.unknownError') }), { type: 'error' });
    }
  }

  async runSnippetOnHosts(snippet, hosts) {
    if (!snippet?.script) {
      showToast(t('hostvault.snippetScriptEmpty'), { type: 'error' });
      return;
    }
    if (!Array.isArray(hosts) || hosts.length === 0) {
      showToast(t('hostvault.selectAtLeastOneHost'), { type: 'error' });
      return;
    }

    const connected = [];
    const failures = [];
    for (const host of hosts) {
      const label = host.alias || host.label || host.config?.host || 'Host';
      const connectionTarget = {
        hostId: host.id,
        config: Object.assign({}, host.config || {}, {
          sessionId: 'snippet_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
        }),
        displayConfig: host.config || {}
      };
      try {
        const res = await TerminalAPI.connectTarget(connectionTarget);
        if (!res.success) {
          failures.push(`${label}: ${normalizeConnectionErrorMessage(res.error || t('hostvault.connectionFailed'))}`);
          continue;
        }
        terminalStore.getState().addSession(res.sessionKey, {
          label,
          config: {
            ...(host.config || {}),
            hostId: host.id
          },
          outputHtml: normalizeTerminalBootstrapOutput(res.output),
          isSudo: res.isSudo,
          infoBoxOutputs: {}
        });
        connected.push({ sessionKey: res.sessionKey, label });
      } catch (err) {
        failures.push(`${label}: ${normalizeConnectionErrorMessage(err)}`);
      }
    }

    if (connected.length > 0) {
      const wsId = 'ws_snippets_' + Date.now().toString();
      const width = 100 / connected.length;
      terminalStore.getState().addWorkspace({
        id: wsId,
        label: `Snippet: ${snippet.name}`,
        isCustomLabel: false,
        isSnippetBatch: connected.length > 1,
        columns: connected.map(item => ({
          id: 'col_' + item.sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_'),
          width,
          panes: [{ sessionKey: item.sessionKey, height: 100 }]
        }))
      });
      terminalStore.getState().setActiveWorkspaceId(wsId);
      terminalStore.getState().setActivePaneSessionKey(connected[0].sessionKey);
      window.location.hash = '#/terminal';

      for (const item of connected) {
        await runSnippetInSession(item.sessionKey, snippet);
      }
    }

    if (failures.length > 0) {
      showToast(t('hostvault.partialBatchFailed', { count: failures.length }), { type: 'error', title: t('hostvault.snippetBatchRun') });
    }
  }

  openReadOnlyLogSession(logRecord) {
    const logSessionKey = `log_session_${logRecord.id}`;
    const tState = terminalStore.getState();

    // 1. 如果此回放 Session 已經在 sessions 中，且我們已經為它建立了 Workspace，直接切換過去即可
    const existingWs = tState.workspaces.find(w => w.id === `ws_${logRecord.id}`);
    if (existingWs) {
      terminalStore.getState().setActiveWorkspaceId(existingWs.id);
      terminalStore.getState().setActivePaneSessionKey(logSessionKey);
      window.location.hash = '#/terminal';
      return;
    }

    // 2. 新建唯讀 Session 快取
    terminalStore.getState().addSession(logSessionKey, {
      label: `Log: ${logRecord.hostName}`,
      config: {
        host: logRecord.hostName,
        isLocal: true, // 避免觸發控制面板
        isLogView: true
      },
      outputHtml: logRecord.outputHtml || t('hostvault.logContentEmpty'),
      isLogView: true,
      isSudo: false
    });

    // 3. 建立一個虛擬的 Workspace 標籤頁
    const wsId = `ws_${logRecord.id}`;
    const colId = `col_${logRecord.id}`;

    const newWorkspace = {
      id: wsId,
      label: `Log: ${logRecord.hostName.substring(0, 12)}${logRecord.hostName.length > 12 ? '...' : ''}`,
      isCustomLabel: false,
      columns: [
        {
          id: colId,
          width: 100,
          panes: [
            {
              sessionKey: logSessionKey,
              height: 100
            }
          ]
        }
      ]
    };

    terminalStore.getState().addWorkspace(newWorkspace);
    terminalStore.getState().setActiveWorkspaceId(wsId);
    terminalStore.getState().setActivePaneSessionKey(logSessionKey);

    // 4. 成功連線，路由跳轉至 /terminal
    window.location.hash = '#/terminal';
  }

  async connectToHost(target, label) {
    const finalConfig = Object.assign({}, target?.config || {}, {
      sessionId: target?.config?.sessionId || 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    });
    const connectionTarget = {
      ...target,
      config: finalConfig
    };
    const displayConfig = connectionTarget.displayConfig || connectionTarget.config || {};
    this.activeConnectionTarget = connectionTarget;

    const progressModal = this.querySelector('#connectionProgressModal');
    const progressTitle = this.querySelector('#progressModalTitle');
    const progressMessage = this.querySelector('#progressModalMessage');
    const progressSpinner = this.querySelector('#progressSpinner');
    const cancelBtn = this.querySelector('#cancelConnectionBtn');

    let isErrorState = false;

    // 1. 初始化並顯示連線進度對話框
    if (progressModal) {
      if (progressSpinner) progressSpinner.style.display = 'block';
      if (progressTitle) {
        progressTitle.textContent = t('hostvault.connectingTo', { label });
        progressTitle.style.color = 'var(--color-text)';
      }
      if (progressMessage) progressMessage.textContent = t('hostvault.preparingConnection');
      if (cancelBtn) {
        cancelBtn.textContent = 'CANCEL';
        cancelBtn.disabled = false;
        cancelBtn.style.opacity = '1';
        cancelBtn.style.borderColor = '#ef4444';
        cancelBtn.style.color = '#ef4444';
      }
      progressModal.classList.remove('hidden');
    }

    // 2. 註冊 Wails 實時進度事件監聽器
    const progressListenerOff = onWailsEvent("connection-progress", (data) => {
      const liveMessage = this.querySelector('#progressModalMessage');
      if (liveMessage && data && !isErrorState) {
        // 後端以 step 代碼標記連線階段；優先用代碼查 i18n，缺對應時回退後端 message。
        const key = data.step ? `hostvault.progress.${data.step}` : '';
        const translated = key ? t(key) : '';
        liveMessage.textContent = (translated && translated !== key) ? translated : (data.message || '');
      }
    });

    // 3. 輔助函數：將 CANCEL 轉化為 CLOSE 關閉對話框
    const setupCloseBehavior = (errorMessage) => {
      isErrorState = true;
      const rawErrorMessage = String(errorMessage || t('hostvault.unknownError'));
      const normalizedErrorMessage = normalizeConnectionErrorMessage(rawErrorMessage);

      const liveSpinner = this.querySelector('#progressSpinner');
      const liveTitle = this.querySelector('#progressModalTitle');
      const liveMessage = this.querySelector('#progressModalMessage');
      const liveCancelBtn = this.querySelector('#cancelConnectionBtn');

      if (liveSpinner) liveSpinner.style.display = 'none';
      if (liveTitle) {
        liveTitle.textContent = t('hostvault.connectionFailed');
        liveTitle.style.color = '#ef4444';
      }
      if (liveMessage) {
        if (rawErrorMessage.includes('UNKNOWN_HOST_KEY')) {
          // 首次連線未知主機：後端回傳 UNKNOWN_HOST_KEY: <host:port> (SHA256:xxxx...)。
          // 顯示指紋與主機，請使用者確認信任後呼叫 ConfirmUnknownHostKey(host, port) 再重連。
          const fpMatch = rawErrorMessage.match(/SHA256:[A-Za-z0-9+/=]+/);
          const fingerprint = fpMatch ? fpMatch[0] : t('hostvault.noFingerprint');
          const hostMatch = rawErrorMessage.match(/UNKNOWN_HOST_KEY:\s*([^\s()]+)/);
          const hostPortText = hostMatch ? hostMatch[1] : `${displayConfig.host || ''}:${displayConfig.port || 22}`;

          liveMessage.innerHTML = `
            <div style="text-align: left; background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <div style="font-weight: 700; color: #eab308; margin-bottom: 6px; font-size: 13px;">${t('hostvault.unknownHostKey')}</div>
              <div style="font-size: 11.5px; line-height: 1.5; color: var(--color-text-muted);">
                ${t('hostvault.unknownHostKeyDesc', { host: escapeHtml(hostPortText) })}
              </div>
              <div style="margin-top: 8px; font-family: monospace; font-size: 11px; color: var(--color-text); word-break: break-all; background: rgba(0,0,0,0.25); border-radius: 4px; padding: 6px;">${escapeHtml(fingerprint)}</div>
            </div>
            <button type="button" id="trustUnknownHostBtn" class="no-drag" style="width: 100%; min-height: 34px; margin-bottom: 12px; background: #eab308; color: #1a1a1a; border: none; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; transition: background 0.2s;">
              ${t('hostvault.trustAndConnect')}
            </button>
          `;

          const trustBtn = this.querySelector('#trustUnknownHostBtn');
          if (trustBtn) {
            trustBtn.addEventListener('click', async () => {
              trustBtn.textContent = t('hostvault.trustingReconnect');
              trustBtn.disabled = true;
              try {
                // 解析 host:port（優先用後端回傳字串，否則回退至 displayConfig）。
                let confirmHost = displayConfig.host || '';
                let confirmPort = displayConfig.port || 22;
                if (hostMatch && hostMatch[1]) {
                  const hp = hostMatch[1];
                  const idx = hp.lastIndexOf(':');
                  if (idx > -1) {
                    confirmHost = hp.slice(0, idx);
                    confirmPort = parseInt(hp.slice(idx + 1), 10) || confirmPort;
                  } else {
                    confirmHost = hp;
                  }
                }
                const confirmResult = await TerminalAPI.confirmUnknownHostKey(confirmHost, Number(confirmPort));
                if (confirmResult && confirmResult.success === false) {
                  throw new Error(confirmResult.error || t('hostvault.trustFailed'));
                }
                // 信任成功，關閉診斷對話框並重試連線。
                const liveModal = this.querySelector('#connectionProgressModal');
                if (liveModal) liveModal.classList.add('hidden');
                this.connectToHost(connectionTarget, label);
              } catch (err) {
                console.error(err);
                trustBtn.textContent = t('hostvault.trustFailedRetry');
                trustBtn.disabled = false;
                trustBtn.style.background = '#7f8c8d';
                showToast(t('hostvault.trustFingerprintFailed', { error: err.message || err }), { type: 'error' });
              }
            });
          }
        } else if (rawErrorMessage.includes('knownhosts: key mismatch')) {
          liveMessage.innerHTML = `
            <div style="text-align: left; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <div style="font-weight: 700; color: #ef4444; margin-bottom: 6px; font-size: 13px;">${t('hostvault.keyMismatch')}</div>
              <div style="font-size: 11.5px; line-height: 1.5; color: var(--color-text-muted);">
                ${t('hostvault.keyMismatchDesc')}
              </div>
            </div>
            <button type="button" id="fixKnownHostsBtn" class="no-drag" style="width: 100%; min-height: 34px; margin-bottom: 12px; background: #e74c3c; color: #fff; border: none; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; transition: background 0.2s;">
              ${t('hostvault.resetFingerprint')}
            </button>
          `;

          const fixBtn = this.querySelector('#fixKnownHostsBtn');
          if (fixBtn) {
            fixBtn.addEventListener('click', async () => {
                fixBtn.textContent = t('hostvault.resetting');
              fixBtn.disabled = true;
              try {
                await HostAPI.removeKnownHost(displayConfig.host, displayConfig.port || 22);
                fixBtn.textContent = t('hostvault.resetSuccess');
                fixBtn.style.background = '#2ecc71';

                const desc = liveMessage.querySelector('div > div:last-child');
                if (desc) {
                  desc.innerHTML = `<span style="color: #2ecc71; font-weight: 700;">${t('hostvault.resetDoneDesc')}</span>`;
                }
              } catch (err) {
                console.error(err);
                fixBtn.textContent = t('hostvault.resetFailedBtn');
                fixBtn.style.background = '#7f8c8d';
                showToast(t('hostvault.resetFailed', { error: err }), { type: 'error' });
              }
            });
          }
        } else {
          liveMessage.textContent = normalizedErrorMessage;
        }
      }
      if (liveCancelBtn) {
        liveCancelBtn.textContent = 'CLOSE';
        liveCancelBtn.disabled = false;
        liveCancelBtn.style.opacity = '1';
        liveCancelBtn.style.borderColor = 'var(--color-primary)';
        liveCancelBtn.style.color = 'var(--color-primary)';
      }
    };

    // 預先清理可能的舊定時器
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    let hasTimedOut = false;
    const timeoutDuration = 10000;
    this.connectionTimeout = setTimeout(async () => {
      hasTimedOut = true;
      console.warn(`[TermiX] Connection to ${label} timed out after ${timeoutDuration}ms`);
      try {
        await TerminalAPI.cancelConnectTarget(connectionTarget);
      } catch (err) {
        console.error('[TermiX] Failed to cancel connection on timeout', err);
      }
      setupCloseBehavior(t('hostvault.tcpTimeout'));
    }, timeoutDuration);

    try {
      // 4. 呼叫 Go 後端發起 PTY 連線 (阻塞 await 流程)
      const res = await TerminalAPI.connectTarget(connectionTarget);

      // 連線回傳後，立即清除逾時定時器
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }

      if (hasTimedOut) {
        return; // 若已超時，直接返回不做處理
      }

      if (res.success) {
        // 連線成功，寫入 TerminalStore
        terminalStore.getState().addSession(res.sessionKey, {
          label,
          config: {
            ...displayConfig,
            ...finalConfig,
            hostId: connectionTarget.hostId || ''
          },
          outputHtml: normalizeTerminalBootstrapOutput(res.output),
          isSudo: res.isSudo,
          infoBoxOutputs: {}
        });

        // 建立 Workspace 結構
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

        terminalStore.getState().addWorkspace(newWorkspace);
        terminalStore.getState().setActiveWorkspaceId(wsId);
        terminalStore.getState().setActivePaneSessionKey(res.sessionKey);

        window.location.hash = '#/terminal';
        setTimeout(() => {
          runStartupCommand(res.sessionKey, {
            ...displayConfig,
            ...finalConfig,
            hostId: connectionTarget.hostId || ''
          }).catch((err) => {
            console.error('[TermiX] Startup command failed', err);
          });
        }, 300);
      } else {
        // 進入非阻斷診斷模式
        setupCloseBehavior(res.error || t('hostvault.unknownError'));
      }
    } catch (e) {
      if (!hasTimedOut) {
        setupCloseBehavior(String(e));
      }
    } finally {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.activeConnectionTarget = null;
      // 5. 狀態清理 Teardown
      if (!isErrorState && !hasTimedOut) {
        const liveModal = this.querySelector('#connectionProgressModal');
        if (liveModal) {
          liveModal.classList.add('hidden');
        }
      }
      if (typeof progressListenerOff === 'function') {
        progressListenerOff();
      }
    }
  }
}

customElements.define('host-list-page', HostListPage);
