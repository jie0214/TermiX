import { kubernetesStore } from './KubernetesStore.js';
import { createKubernetesClusterDraft, validateKubernetesCluster } from './KubernetesModel.js';
import { kubernetesSessionStore, KUBERNETES_SESSION_ID } from './KubernetesSessionStore.js';
import { terminalStore } from '../terminal/TerminalStore.js';
import { t } from '../../i18n/index.ts';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 雲端供應商 / Kubernetes 產品圖示（線稿，白色 stroke 配彩色底）。
// 六邊形（pointy-top）共用給 EKS / GKE。
const HEX = `M12 2.3 20.4 7.15V16.85L12 21.7 3.6 16.85V7.15Z`;
// EKS：六邊形 + K
const EKS_GLYPH = `<path d="${HEX}"/><path d="M10.4 7.8V16.2M10.4 12 14.9 7.8M10.4 12 14.9 16.2"/>`;
// GKE：六邊形 + 等角立方體
const GKE_GLYPH = `<path d="${HEX}"/><path d="M12 8 15.5 10 12 12 8.5 10Z"/><path d="M8.5 10V14L12 16V12Z"/><path d="M15.5 10V14L12 16V12Z"/>`;
// AKS：Azure「A」雙三角形（實心）
const AKS_GLYPH = `<g fill="currentColor" stroke="none"><path d="M10.6 4 4 20h5l1.2-3.6h4.4L13.4 13h-2.3l1.3-4L16 20h4L13.6 4Z"/></g>`;
// 通用 Kubernetes：船舵輪（外圈 + 輪轂 + 7 輪輻 + 把手）
const K8S_WHEEL_GLYPH = `<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="2.4"/><path d="M12 9.6 12 3.6M13.88 10.5 18.57 6.76M14.34 12.53 20.19 13.87M13.04 14.16 15.64 19.57M10.96 14.16 8.36 19.57M9.66 12.53 3.81 13.87M10.12 10.5 5.43 6.76"/><g fill="currentColor" stroke="none"><circle cx="12" cy="2.4" r="0.9"/><circle cx="19.51" cy="6.01" r="0.9"/><circle cx="21.36" cy="14.14" r="0.9"/><circle cx="16.17" cy="20.65" r="0.9"/><circle cx="7.83" cy="20.65" r="0.9"/><circle cx="2.64" cy="14.14" r="0.9"/><circle cx="4.49" cy="6.01" r="0.9"/></g>`;

// 依 cluster 的 context / cluster 名稱 / server 判斷供應商，
// 回傳 { bg, glyph, label }；無法判定時回傳通用 Kubernetes 圖示（船舵輪）。
function detectClusterProvider(cluster) {
  const hay = `${cluster.clusterName || ''} ${cluster.contextName || ''} ${cluster.server || ''}`.toLowerCase();
  if (hay.includes('eks') || hay.includes('arn:aws') || hay.includes('eks.amazonaws')) {
    return { bg: '#FF9900', glyph: EKS_GLYPH, label: 'EKS' };
  }
  if (hay.includes('gke_') || hay.includes('.gke.') || hay.includes('container.googleapis') || hay.includes('gke')) {
    return { bg: '#4285F4', glyph: GKE_GLYPH, label: 'GKE' };
  }
  if (hay.includes('azmk8s.io') || hay.includes('aks') || hay.includes('azure')) {
    return { bg: '#0078D4', glyph: AKS_GLYPH, label: 'AKS' };
  }
  return { bg: '#326CE5', glyph: K8S_WHEEL_GLYPH, label: '' };
}

function renderEditIcon() {
  return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  `;
}

export class KubernetesPage extends HTMLElement {
  constructor() {
    super();
    this.unsubscribe = null;
    this.unsubscribeSession = null;
    this.connectingClusterId = '';
    this.searchQuery = '';
    this.formDraft = null;
    this.validationErrors = {};
    this.operationError = '';
    this.saving = false;
    this.lastViewFingerprint = null;
  }

  connectedCallback() {
    this.lastViewFingerprint = this.getViewFingerprint();
    this.render();
    this.setupListeners();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.unsubscribe = kubernetesStore.subscribe(() => {
      // 先同步表單草稿（syncDraftFromStore 只在 selectedCluster 切換時才會動 this.formDraft，
      // 且 selectedCluster 已納入指紋，故草稿變動一定伴隨指紋變動），再依指紋決定是否重建。
      this.syncDraftFromStore();
      this.renderIfChanged();
    });
    if (this.unsubscribeSession) {
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    }
    this.unsubscribeSession = kubernetesSessionStore.subscribe(() => {
      this.renderIfChanged();
    });

    const state = kubernetesStore.getState();
    if (state.clusters.length === 0 && !state.isLoading && !state.loadError) {
      state.loadClusters().catch(() => {});
    }
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.unsubscribeSession) this.unsubscribeSession();
  }

  syncDraftFromStore() {
    const selected = kubernetesStore.getState().selectedCluster;
    if (!selected) {
      this.formDraft = null;
      return;
    }
    if (!this.formDraft || this.formDraft.id !== selected.id) {
      this.formDraft = { ...selected };
      this.validationErrors = {};
      this.operationError = '';
    }
  }

  // 訂閱回呼共用入口：僅在視圖指紋實際改變時才整頁重建並重綁事件。
  // 指紋未變時直接跳過，避免輸入框失焦、捲動重置與無謂的事件重綁。
  renderIfChanged() {
    const currentFingerprint = this.getViewFingerprint();
    if (currentFingerprint === this.lastViewFingerprint) return;
    // render() 內部會在結尾重新計算並更新 this.lastViewFingerprint。
    this.render();
    this.setupListeners();
  }

  // 涵蓋 render()（含 renderCard / renderDrawer / renderField）實際讀取的所有 store 切片：
  //   kubernetesStore：clusters（每張卡片讀 id / isCurrent / displayName / contextName /
  //                    clusterName / server / namespace，故整包序列化）、isLoading、loadError、
  //                    selectedCluster（renderDrawer 草稿回退與 syncDraftFromStore）、
  //                    drawerOpen、availableUsers、users
  //   kubernetesSessionStore：connectionStatus（renderCard 連接中狀態）、loadError
  // 採完整序列化，寧可涵蓋過多也不漏；任何上述變更都會改變指紋而觸發重建，
  // 確保不會出現「狀態變了但畫面沒更新」的回歸。
  // 注意：此 guard 僅用於 store 訂閱回呼；元件內以 this.render() 直接觸發的互動
  //（搜尋輸入、連接中、儲存中等，皆為 this.* 實例狀態）不經過 guard，行為完全不變，
  //  且 render() 結尾會更新指紋基準，避免直接 render 後訂閱回呼誤判為「已變更」而重複重建。
  getViewFingerprint() {
    const k = kubernetesStore.getState();
    const s = kubernetesSessionStore.getState();
    try {
      return JSON.stringify({
        clusters: k.clusters,
        isLoading: k.isLoading,
        loadError: k.loadError,
        selectedCluster: k.selectedCluster,
        drawerOpen: k.drawerOpen,
        availableUsers: k.availableUsers,
        users: k.users,
        connectionStatus: s.connectionStatus,
        sessionLoadError: s.loadError
      });
    } catch (e) {
      // 序列化失敗（理論上不會發生）時回傳唯一值，強制重建以確保安全。
      return `__fingerprint_error__${Date.now()}_${Math.random()}`;
    }
  }

  getFilteredClusters(state) {
    const query = this.searchQuery.trim().toLocaleLowerCase('zh-Hant');
    if (!query) return state.clusters;
    return state.clusters.filter((cluster) => [
      cluster.displayName,
      cluster.contextName,
      cluster.clusterName,
      cluster.server,
      cluster.namespace
    ].some(value => String(value || '').toLocaleLowerCase('zh-Hant').includes(query)));
  }

  renderCard(cluster, state) {
    const sessionState = kubernetesSessionStore.getState();
    const connecting = sessionState.connectionStatus === 'connecting' && this.connectingClusterId === cluster.id;
    const provider = detectClusterProvider(cluster);
    const iconStyle = ` style="background:${provider.bg};color:#fff;"`;
    const iconGlyph = provider.glyph;
    return `
      <article class="vault-card kubernetes-card ${cluster.isCurrent ? 'is-current' : ''}" data-cluster-id="${escapeHtml(cluster.id)}">
        <div class="kubernetes-card-body">
          <div class="vault-card-icon kubernetes-card-icon"${iconStyle} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              ${iconGlyph}
            </svg>
          </div>
          <div class="vault-card-info kubernetes-card-info">
            <div class="kubernetes-card-heading">
              <div class="vault-card-title" title="${escapeHtml(cluster.displayName)}">${escapeHtml(cluster.displayName)}</div>
              ${provider ? `<span class="kubernetes-provider-badge">${provider.label}</span>` : ''}
              ${cluster.isCurrent ? `<span class="kubernetes-current-badge">${t('k8s.page.currentBadge')}</span>` : ''}
            </div>
            <div class="kubernetes-card-context" title="${escapeHtml(cluster.contextName)}">${t('k8s.page.contextPrefix')}${escapeHtml(cluster.contextName)}</div>
            <dl class="kubernetes-card-details">
              <div><dt>Cluster</dt><dd title="${escapeHtml(cluster.clusterName)}">${escapeHtml(cluster.clusterName)}</dd></div>
              <div><dt>Server</dt><dd title="${escapeHtml(cluster.server)}">${escapeHtml(cluster.server || t('k8s.page.serverUnset'))}</dd></div>
              <div><dt>Namespace</dt><dd>${escapeHtml(cluster.namespace || 'default')}</dd></div>
            </dl>
          </div>
        </div>
        <button type="button" class="no-drag vault-card-edit-btn kubernetes-edit-btn" data-cluster-id="${escapeHtml(cluster.id)}" title="${t('k8s.page.editClusterTitle')}" aria-label="${t('k8s.page.editClusterAria', { name: escapeHtml(cluster.displayName) })}">
          ${renderEditIcon()}
        </button>
        <div class="kubernetes-card-footer">
          <button type="button" class="no-drag kubernetes-connect-btn" data-cluster-id="${escapeHtml(cluster.id)}" ${sessionState.connectionStatus === 'connecting' ? 'disabled' : ''}>
            ${connecting ? t('k8s.page.connecting') : t('common.connect')}
          </button>
        </div>
      </article>
    `;
  }

  renderField(name, label, value, options = {}) {
    const error = this.validationErrors[name] || '';
    const required = options.required ? 'required' : '';
    const input = options.type === 'checkbox'
      ? `<input class="no-drag kubernetes-checkbox" id="kubernetes-${name}" name="${name}" type="checkbox" ${value ? 'checked' : ''}>`
      : `<input class="no-drag" id="kubernetes-${name}" name="${name}" type="${options.type || 'text'}" value="${escapeHtml(value)}" placeholder="${escapeHtml(options.placeholder || '')}" ${options.list ? `list="${options.list}"` : ''} ${required} ${options.readonly ? 'readonly' : ''} aria-invalid="${error ? 'true' : 'false'}">`;
    return `
      <label class="kubernetes-form-field ${options.type === 'checkbox' ? 'is-checkbox' : ''}">
        <span>${label}${options.required ? `<strong aria-hidden="true">${t('k8s.page.requiredMark')}</strong>` : ''}</span>
        ${input}
        ${error ? `<small class="kubernetes-field-error">${escapeHtml(error)}</small>` : ''}
      </label>
    `;
  }

  renderDrawer(state) {
    const draft = this.formDraft || state.selectedCluster || createKubernetesClusterDraft();
    const users = state.availableUsers || state.users || [];
    const isNew = !draft.id || draft.id.startsWith('k8s_draft_');
    return `
      <aside id="kubernetesDrawer" class="vault-drawer kubernetes-drawer ${state.drawerOpen ? 'open' : ''}" aria-hidden="${state.drawerOpen ? 'false' : 'true'}">
        <div class="settings-dialog kubernetes-drawer-dialog">
          <header class="settings-header kubernetes-drawer-header">
            <div>
              <span>Kubernetes</span>
              <h2>${isNew ? t('k8s.page.newCluster') : t('k8s.page.editClusterHeading')}</h2>
            </div>
            <button type="button" id="closeKubernetesDrawer" class="no-drag kubernetes-close-btn" title="${t('k8s.page.closeTitle')}" aria-label="${t('k8s.page.closeDrawerAria')}">&times;</button>
          </header>
          <form id="kubernetesClusterForm" class="kubernetes-form" novalidate>
            <div class="settings-body kubernetes-form-body">
              ${this.operationError ? `<div class="kubernetes-inline-error" role="alert">${escapeHtml(this.operationError)}</div>` : ''}
              <section>
                <h3>${t('k8s.page.sectionBasic')}</h3>
                ${this.renderField('displayName', t('k8s.page.fieldDisplayName'), draft.displayName, { required: true, placeholder: t('k8s.page.phDisplayName') })}
                ${this.renderField('contextName', t('k8s.page.fieldContextName'), draft.contextName, { required: true, readonly: !isNew, placeholder: t('k8s.page.phContextName') })}
                ${this.renderField('clusterName', t('k8s.page.fieldClusterName'), draft.clusterName, { required: true, readonly: !isNew, placeholder: t('k8s.page.phClusterName') })}
                ${this.renderField('namespace', t('k8s.page.fieldDefaultNamespace'), draft.namespace, { placeholder: 'default' })}
              </section>
              <section>
                <h3>${t('k8s.page.sectionConnection')}</h3>
                ${this.renderField('server', t('k8s.page.fieldApiServer'), draft.server, { required: true, type: 'url', placeholder: 'https://kubernetes.example.com:6443' })}
                ${this.renderField('userName', t('k8s.page.fieldKubeconfigUser'), draft.userName, { required: true, list: 'kubernetesUserOptions', placeholder: t('k8s.page.phKubeconfigUser') })}
                <datalist id="kubernetesUserOptions">${users.map(user => `<option value="${escapeHtml(user)}"></option>`).join('')}</datalist>
                ${this.renderField('certificateAuthority', t('k8s.page.fieldCaPath'), draft.certificateAuthority, { placeholder: '/path/to/ca.crt' })}
                ${this.renderField('insecureSkipTLSVerify', t('k8s.page.fieldInsecureTls'), draft.insecureSkipTLSVerify, { type: 'checkbox' })}
              </section>
              <section>
                <h3>${t('k8s.page.sectionKubeconfig')}</h3>
                ${this.renderField('kubeconfigPath', t('k8s.page.fieldKubeconfigPath'), draft.kubeconfigPath, { required: true, readonly: !isNew, placeholder: '~/.kube/config' })}
              </section>
            </div>
            <footer class="settings-footer kubernetes-form-footer">
              <button type="button" id="cancelKubernetesDrawer" class="no-drag kubernetes-secondary-btn">${t('k8s.page.cancel')}</button>
              <button type="submit" class="no-drag kubernetes-primary-btn" ${this.saving ? 'disabled' : ''}>${this.saving ? t('k8s.page.saving') : t('k8s.page.save')}</button>
            </footer>
          </form>
        </div>
      </aside>
    `;
  }

  render() {
    const state = kubernetesStore.getState();
    const sessionState = kubernetesSessionStore.getState();
    const clusters = this.getFilteredClusters(state);
    const loadError = state.loadError || sessionState.loadError || '';
    this.innerHTML = `
      <div class="kubernetes-page-layout">
        <main class="kubernetes-main-board">
          <div class="kubernetes-toolbar">
            <div>
              <h1>${t('k8s.page.title')}</h1>
              <p>${t('k8s.page.subtitle')}</p>
            </div>
            <div class="kubernetes-toolbar-actions">
              <button type="button" id="reloadKubernetesBtn" class="no-drag kubernetes-secondary-btn" ${state.isLoading ? 'disabled' : ''}>${state.isLoading ? t('k8s.page.loading') : t('k8s.page.reload')}</button>
              <button type="button" id="newKubernetesClusterBtn" class="no-drag kubernetes-primary-btn">${t('k8s.page.newClusterButton')}</button>
            </div>
          </div>
          <div class="vault-search-bar kubernetes-search-bar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="no-drag" id="kubernetesSearchInput" type="search" placeholder="${t('k8s.page.searchPlaceholder')}" autocomplete="off" value="${escapeHtml(this.searchQuery)}" aria-label="${t('k8s.page.searchAria')}">
          </div>
          ${loadError ? `<div class="kubernetes-load-error" role="alert"><strong>${t('k8s.page.loadFailed')}</strong><span>${escapeHtml(loadError)}</span></div>` : ''}
          <div class="kubernetes-scroll-content">
            ${state.isLoading && state.clusters.length === 0 ? `
              <div class="kubernetes-state-panel"><span class="kubernetes-spinner"></span><h2>${t('k8s.page.readingKubeconfig')}</h2></div>
            ` : clusters.length > 0 ? `
              <div class="vault-grid kubernetes-grid">${clusters.map(cluster => this.renderCard(cluster, state)).join('')}</div>
            ` : `
              <div class="kubernetes-state-panel">
                <div class="kubernetes-empty-icon">K8s</div>
                <h2>${this.searchQuery ? t('k8s.page.noMatch') : t('k8s.page.noClusters')}</h2>
                <p>${this.searchQuery ? t('k8s.page.noMatchDetail') : t('k8s.page.noClustersDetail')}</p>
              </div>
            `}
          </div>
        </main>
        ${this.renderDrawer(state)}
      </div>
    `;
    // 更新指紋基準：不論此次 render 由訂閱回呼或元件內直接互動觸發，
    // 皆以最新 store 切片為準，確保後續訂閱回呼的指紋比對正確。
    this.lastViewFingerprint = this.getViewFingerprint();
  }

  readFormDraft(form) {
    const data = new FormData(form);
    return {
      ...(this.formDraft || kubernetesStore.getState().selectedCluster || {}),
      displayName: String(data.get('displayName') || '').trim(),
      contextName: String(data.get('contextName') || '').trim(),
      clusterName: String(data.get('clusterName') || '').trim(),
      server: String(data.get('server') || '').trim(),
      userName: String(data.get('userName') || '').trim(),
      namespace: String(data.get('namespace') || '').trim(),
      certificateAuthority: String(data.get('certificateAuthority') || '').trim(),
      insecureSkipTLSVerify: data.get('insecureSkipTLSVerify') === 'on',
      kubeconfigPath: String(data.get('kubeconfigPath') || '').trim()
    };
  }

  setupListeners() {
    this.querySelector('#kubernetesSearchInput')?.addEventListener('input', (event) => {
      this.searchQuery = event.target.value;
      this.render();
      this.setupListeners();
      const input = this.querySelector('#kubernetesSearchInput');
      input?.focus();
      input?.setSelectionRange(this.searchQuery.length, this.searchQuery.length);
    });

    this.querySelector('#reloadKubernetesBtn')?.addEventListener('click', () => {
      this.operationError = '';
      kubernetesStore.getState().reloadClusters().catch(() => {});
    });

    this.querySelector('#newKubernetesClusterBtn')?.addEventListener('click', () => {
      this.formDraft = null;
      this.validationErrors = {};
      this.operationError = '';
      kubernetesStore.getState().openCreateDrawer();
    });

    this.querySelectorAll('.kubernetes-edit-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const cluster = kubernetesStore.getState().clusters.find(item => item.id === button.dataset.clusterId);
        if (!cluster) return;
        this.formDraft = null;
        this.validationErrors = {};
        this.operationError = '';
        kubernetesStore.getState().openEditDrawer(cluster);
      });
    });

    this.querySelectorAll('.kubernetes-connect-btn').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (button.disabled) return;
        try {
          const cluster = kubernetesStore.getState().clusters.find(item => item.id === button.dataset.clusterId);
          if (!cluster) return;
          this.connectingClusterId = cluster.id;
          this.render();
          this.setupListeners();
          await kubernetesSessionStore.getState().connectCluster(cluster);
          terminalStore.getState().setActiveWorkspaceId(KUBERNETES_SESSION_ID);
          terminalStore.getState().setActivePaneSessionKey(null);
          const app = this.closest('termix-app');
          app?.collapseControlSidebar?.();
          window.location.hash = '#/kubernetes-session';
        } catch (error) {
          this.operationError = error?.message || String(error);
        } finally {
          this.connectingClusterId = '';
          this.render();
          this.setupListeners();
        }
      });
    });

    const closeDrawer = () => {
      this.formDraft = null;
      this.validationErrors = {};
      this.operationError = '';
      kubernetesStore.getState().closeDrawer();
    };
    this.querySelector('#closeKubernetesDrawer')?.addEventListener('click', closeDrawer);
    this.querySelector('#cancelKubernetesDrawer')?.addEventListener('click', closeDrawer);

    this.querySelector('#kubernetesClusterForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      this.formDraft = this.readFormDraft(event.currentTarget);
      const result = validateKubernetesCluster(this.formDraft);
      if (!result.valid) {
        this.validationErrors = result.errors;
        this.operationError = t('k8s.page.fixFieldsError');
        this.render();
        this.setupListeners();
        this.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }

      this.validationErrors = {};
      this.operationError = '';
      this.saving = true;
      this.render();
      this.setupListeners();
      try {
        await kubernetesStore.getState().saveCluster(result.value);
        this.formDraft = null;
      } catch (error) {
        this.operationError = error?.message || String(error);
      } finally {
        this.saving = false;
        this.render();
        this.setupListeners();
      }
    });
  }
}

if (!customElements.get('kubernetes-page')) {
  customElements.define('kubernetes-page', KubernetesPage);
}
