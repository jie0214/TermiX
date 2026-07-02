import { kubernetesStore } from './KubernetesStore.js';
import { createKubernetesClusterDraft, validateKubernetesCluster } from './KubernetesModel.js';
import { kubernetesSessionStore, KUBERNETES_SESSION_ID } from './KubernetesSessionStore.js';
import { terminalStore } from '../terminal/TerminalStore.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    return `
      <article class="vault-card kubernetes-card ${cluster.isCurrent ? 'is-current' : ''}" data-cluster-id="${escapeHtml(cluster.id)}">
        <div class="kubernetes-card-body">
          <div class="vault-card-icon kubernetes-card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5z"/><circle cx="12" cy="12" r="2.5"/><path d="M12 5.5v4M12 14.5v4M6.5 9l3.5 2M14 13l3.5 2M17.5 9 14 11M10 13l-3.5 2"/>
            </svg>
          </div>
          <div class="vault-card-info kubernetes-card-info">
            <div class="kubernetes-card-heading">
              <div class="vault-card-title" title="${escapeHtml(cluster.displayName)}">${escapeHtml(cluster.displayName)}</div>
              ${cluster.isCurrent ? '<span class="kubernetes-current-badge">目前使用中</span>' : ''}
            </div>
            <div class="kubernetes-card-context" title="${escapeHtml(cluster.contextName)}">Context：${escapeHtml(cluster.contextName)}</div>
            <dl class="kubernetes-card-details">
              <div><dt>Cluster</dt><dd title="${escapeHtml(cluster.clusterName)}">${escapeHtml(cluster.clusterName)}</dd></div>
              <div><dt>Server</dt><dd title="${escapeHtml(cluster.server)}">${escapeHtml(cluster.server || '未設定')}</dd></div>
              <div><dt>Namespace</dt><dd>${escapeHtml(cluster.namespace || 'default')}</dd></div>
            </dl>
          </div>
        </div>
        <button type="button" class="no-drag vault-card-edit-btn kubernetes-edit-btn" data-cluster-id="${escapeHtml(cluster.id)}" title="編輯 Kubernetes Cluster" aria-label="編輯 ${escapeHtml(cluster.displayName)}">
          ${renderEditIcon()}
        </button>
        <div class="kubernetes-card-footer">
          <button type="button" class="no-drag kubernetes-connect-btn" data-cluster-id="${escapeHtml(cluster.id)}" ${sessionState.connectionStatus === 'connecting' ? 'disabled' : ''}>
            ${connecting ? '連接中...' : '連接'}
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
        <span>${label}${options.required ? '<strong aria-hidden="true"> *</strong>' : ''}</span>
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
              <h2>${isNew ? '新增 Cluster' : '編輯 Cluster'}</h2>
            </div>
            <button type="button" id="closeKubernetesDrawer" class="no-drag kubernetes-close-btn" title="關閉" aria-label="關閉 Drawer">&times;</button>
          </header>
          <form id="kubernetesClusterForm" class="kubernetes-form" novalidate>
            <div class="settings-body kubernetes-form-body">
              ${this.operationError ? `<div class="kubernetes-inline-error" role="alert">${escapeHtml(this.operationError)}</div>` : ''}
              <section>
                <h3>基本資訊</h3>
                ${this.renderField('displayName', '顯示名稱', draft.displayName, { required: true, placeholder: '例如：正式環境' })}
                ${this.renderField('contextName', 'Context 名稱', draft.contextName, { required: true, readonly: !isNew, placeholder: '例如：production-admin' })}
                ${this.renderField('clusterName', 'Cluster 名稱', draft.clusterName, { required: true, readonly: !isNew, placeholder: '例如：production' })}
                ${this.renderField('namespace', '預設 Namespace', draft.namespace, { placeholder: 'default' })}
              </section>
              <section>
                <h3>連線設定</h3>
                ${this.renderField('server', 'API Server', draft.server, { required: true, type: 'url', placeholder: 'https://kubernetes.example.com:6443' })}
                ${this.renderField('userName', 'kubeconfig User', draft.userName, { required: true, list: 'kubernetesUserOptions', placeholder: '選擇或輸入既有 User' })}
                <datalist id="kubernetesUserOptions">${users.map(user => `<option value="${escapeHtml(user)}"></option>`).join('')}</datalist>
                ${this.renderField('certificateAuthority', 'Certificate Authority 路徑', draft.certificateAuthority, { placeholder: '/path/to/ca.crt' })}
                ${this.renderField('insecureSkipTLSVerify', '略過 TLS 憑證驗證', draft.insecureSkipTLSVerify, { type: 'checkbox' })}
              </section>
              <section>
                <h3>kubeconfig</h3>
                ${this.renderField('kubeconfigPath', 'kubeconfig 路徑', draft.kubeconfigPath, { required: true, readonly: !isNew, placeholder: '~/.kube/config' })}
              </section>
            </div>
            <footer class="settings-footer kubernetes-form-footer">
              <button type="button" id="cancelKubernetesDrawer" class="no-drag kubernetes-secondary-btn">取消</button>
              <button type="submit" class="no-drag kubernetes-primary-btn" ${this.saving ? 'disabled' : ''}>${this.saving ? '儲存中...' : '儲存'}</button>
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
              <h1>Kubernetes Clusters</h1>
              <p>管理 kubeconfig 叢集並快速切換 Context。</p>
            </div>
            <div class="kubernetes-toolbar-actions">
              <button type="button" id="reloadKubernetesBtn" class="no-drag kubernetes-secondary-btn" ${state.isLoading ? 'disabled' : ''}>${state.isLoading ? '載入中...' : '重新載入'}</button>
              <button type="button" id="newKubernetesClusterBtn" class="no-drag kubernetes-primary-btn">+ NEW CLUSTER</button>
            </div>
          </div>
          <div class="vault-search-bar kubernetes-search-bar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="no-drag" id="kubernetesSearchInput" type="search" placeholder="搜尋顯示名稱、Context、Cluster 或 Server..." autocomplete="off" value="${escapeHtml(this.searchQuery)}" aria-label="搜尋 Kubernetes Cluster">
          </div>
          ${loadError ? `<div class="kubernetes-load-error" role="alert"><strong>載入 Kubernetes 設定失敗</strong><span>${escapeHtml(loadError)}</span></div>` : ''}
          <div class="kubernetes-scroll-content">
            ${state.isLoading && state.clusters.length === 0 ? `
              <div class="kubernetes-state-panel"><span class="kubernetes-spinner"></span><h2>正在讀取 kubeconfig</h2><p>正在載入使用者目錄下的 Kubernetes Context。</p></div>
            ` : clusters.length > 0 ? `
              <div class="vault-grid kubernetes-grid">${clusters.map(cluster => this.renderCard(cluster, state)).join('')}</div>
            ` : `
              <div class="kubernetes-state-panel">
                <div class="kubernetes-empty-icon">K8s</div>
                <h2>${this.searchQuery ? '找不到符合條件的 Cluster' : '尚未找到 Kubernetes Cluster'}</h2>
                <p>${this.searchQuery ? '請調整搜尋條件。' : '可重新載入 ~/.kube/config，或建立新的 Cluster 設定。'}</p>
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
        this.operationError = '請修正標示欄位後再儲存。';
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
