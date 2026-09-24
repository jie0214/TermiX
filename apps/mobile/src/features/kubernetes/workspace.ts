import type { AwsProfile, EksConfig } from '../aws/repository.ts';
export type KubeContext = { eks?: EksConfig; issue?: string; context: string; cluster: string; namespace: string };
export type KubeProfile = KubeContext & { contexts?: KubeContext[] };
export type Health = "healthy" | "unhealthy" | "pending" | "completed" | "stopped" | "terminating" | "unknown";
export type LimitValue = {value?:number|null;state:'set'|'unset'|'unknown';scope?:'pod'|'containers'};
export type PodLimits = {cpu:LimitValue;memory:LimitValue;containers:{name:string;cpu:LimitValue;memory:LimitValue}[]};
export type PodSummary = { limits?:PodLimits; reason?: string; health?: Health; name: string; namespace: string; phase: string; ready: number; total: number };
export type PodList = { items: PodSummary[]; hasMore: boolean };
export type ResourceKind = 'pods' | 'deployments' | 'statefulsets' | 'configmaps';
export type ExtraResourceKind = Exclude<ResourceKind, 'pods'>;
export const resourceLabels: Record<ResourceKind, string> = { pods: 'Pod', deployments: 'Deployment', statefulsets: 'StatefulSet', configmaps: 'ConfigMap' };
export type ResourceSummary = { health?: Health; name: string; namespace: string; ready: number; desired: number; updated: number; keyCount: number; immutable: boolean };
export type ResourceList = { items: ResourceSummary[]; hasMore: boolean };
export type ConfigMapDetail = { name: string; namespace: string; immutable: boolean; entries: { key: string; value: string; binary: boolean; bytes: number; truncated: boolean }[]; truncated: boolean };
export type PodContainers = { containers: { name: string; kind: 'regular' | 'init' | 'ephemeral' }[] };
export type PodLog = { text: string; truncated: boolean };
export type LogPanelState = PodLog & PodContainers & {
  pod: string; container: string; previous: boolean;
  optionsStatus: 'loading' | 'ready' | 'error'; status: 'idle' | 'loading' | 'ready' | 'error'; message: string;
};
export type WorkloadKind = 'deployments' | 'statefulsets';
export type ScaleValue = { uid: string; resourceVersion: string; replicas: number };
export type ScalePanelState = {
  name: string; kind: WorkloadKind; namespace: string; cluster: string; context: string;
  value?: ScaleValue; input: string; message: string;
  status: 'loading' | 'editing' | 'confirming' | 'submitting' | 'success' | 'error';
};
export type ContainerUsage = { name: string; cpuMilli: number; memoryMiB: number };
export type PodMetrics = { timestamp: string; windowSeconds: number; cpuMilli: number; memoryMiB: number; containers: ContainerUsage[] };
export type MetricsPanelState = { pod: string; status: 'loading' | 'ready' | 'error'; value?: PodMetrics; message: string };
export interface KubeClient {
 listPodMetrics(raw:string,namespace:string):Promise<Record<string,PodMetrics>>;
 listNamespaces(raw: string, cursor: string): Promise<{items: string[]; cursor: string}>;
 listAWSProfiles(region: string): Promise<AwsProfile[]>;
 selectAWSProfile(raw: string, name: string): Promise<string>;
  getPodMetrics(raw: string, namespace: string, name: string): Promise<PodMetrics>;
  getScale(raw: string, namespace: string, kind: WorkloadKind, name: string): Promise<ScaleValue>;
  updateScale(raw: string, namespace: string, kind: WorkloadKind, name: string, value: ScaleValue): Promise<ScaleValue>;
  getPodContainers(raw: string, namespace: string, name: string): Promise<PodContainers>;
  getPodLogs(raw: string, namespace: string, name: string, container: string, previous: boolean): Promise<PodLog>;
  selectContext(raw: string, name: string): Promise<string>;
  inspect(raw: string): Promise<KubeProfile>;
  listPods(raw: string, namespace: string): Promise<PodList>;
  listResources(raw: string, namespace: string, kind: ExtraResourceKind): Promise<ResourceList>;
  getConfigMap(raw: string, namespace: string, name: string): Promise<ConfigMapDetail>;
}
export interface KubeStorage { load(): Promise<string | null>; save(raw: string): Promise<void> }
export type KubeState = { updatedAt?: number; listMetrics?: Record<string,PodMetrics>; listMetricsMessage?: string; namespaces?: {items:string[];cursor:string;status:"loading"|"ready"|"error";message:string}; configBusy?: boolean; metrics?: MetricsPanelState; scaleNotice?: string; scale?: ScalePanelState; logs?: LogPanelState; kind: ResourceKind; resources: ResourceSummary[]; detail?: ConfigMapDetail; detailName?: string; detailStatus: 'idle' | 'loading' | 'ready' | 'error'; detailMessage: string; profile?: KubeProfile; namespace: string; pods: PodSummary[]; hasMore: boolean; status: 'idle' | 'loading' | 'ready' | 'error'; message: string };

const messages: Record<string, string> = {
 namespaces_forbidden: "沒有列出 namespace 的權限；仍可查詢 kubeconfig 指定的 namespace。",
 aws_profile_invalid: "此 AWS profile 無法用於目前叢集。",
  unsupported_eks_exec: '僅支援標準 aws eks get-token；請提供 Region，不接受自訂端點或其他 exec 指令。',
  aws_login_required: '請先在設定新增並啟用同名 AWS profile。',
  aws_profile_disabled: '此 AWS profile 已停用。',
  aws_credentials_expired: 'AWS 暫時憑證已過期，請更新此 profile。',
  aws_credentials_invalid: 'AWS 憑證無效，請確認 Access Key 與 Secret Key。',
  aws_session_token_required: '暫時憑證需要 Session Token。',
  aws_access_denied: 'AWS 拒絕此操作，請確認 IAM 權限或 Role 設定。',
  aws_connection_failed: '無法完成 AWS 驗證，請確認網路後重試。',
  aws_signing_failed: 'EKS token 產生失敗，請確認 profile 與手機時間。',
  config_invalid: 'kubeconfig 無效，請確認目前 context、叢集與 CA 資料。',
  insecure_tls: '此設定未驗證 HTTPS 伺服器，已拒絕匯入。',
  unsupported_auth: '支援內嵌 token 或用戶端憑證；不支援檔案參照與非 AWS EKS 的 exec 驗證。',
  missing_token: '目前 context 沒有內嵌 token 或用戶端憑證。',
  ambiguous_auth: '請只保留 token 或用戶端憑證其中一種驗證方式。',
  certificate_incomplete: '請同時提供內嵌用戶端憑證與私鑰。',
  certificate_invalid: '憑證或私鑰格式無效、不匹配，或私鑰已加密。',
  certificate_expired: '用戶端憑證已過期，請更新後重新匯入。',
  certificate_not_yet_valid: '用戶端憑證尚未生效，請確認憑證日期與手機時間。',
  invalid_namespace: 'namespace 名稱無效。',
  unauthorized: '叢集拒絕登入，請確認驗證設定。',
  forbidden: '此帳號沒有查看此資源的權限。',
  connection_failed: '無法連線，請確認網路、API 位址與 TLS 憑證。',
  api_failed: '叢集回應無效或暫時無法提供資源。',
  not_found: '資源不存在或 API 不支援，請重新查詢。',
  logs_unavailable: '此容器目前無法提供 Log，可能尚未啟動或沒有前次紀錄。',
  scale_conflict: '資源已變更，請重新讀取後再確認。',
  scale_unknown: '無法確認是否已生效，請重新讀取副本數；不會自動重送。',
  api_rejected: '叢集拒絕此變更，請重新讀取並確認設定。',
  invalid_scale: '請輸入 0 至 2147483647 的整數副本數。',
  metrics_missing: '此 Pod 尚無用量資料，或叢集未提供 Metrics API。',
  metrics_unavailable: '用量服務暫時無法使用，請稍後重試。',
  metrics_invalid: '用量資料不完整或格式無效，請重新讀取。',
  invalid_resource: '資源名稱或類型無效。',
};
export function kubeMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : '';
  const code = Object.keys(messages).find(key => new RegExp(`(?:^|[^a-z_])${key}(?:$|[^a-z_])`).test(detail));
  return code ? messages[code] : '操作失敗，請檢查設定後重試。';
}
const emptyDetail = { detail: undefined, detailName: undefined, detailStatus: 'idle' as const, detailMessage: '' };
const emptyResults = { listMetrics: undefined, listMetricsMessage: undefined, updatedAt: undefined, metrics: undefined, scaleNotice: undefined, scale: undefined, logs: undefined, pods: [], resources: [], hasMore: false, ...emptyDetail };
export class KubernetesWorkspace {
  private state: KubeState = { kind: 'pods', namespace: '', ...emptyResults, status: 'idle', message: '' };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private detailEpoch = 0;
  private logEpoch = 0;
  private metricsEpoch = 0;
  private importPending = false;
  private scaleEpoch = 0;
  private scalePending = false;
  private client: KubeClient; private storage: KubeStorage;
  constructor(client: KubeClient, storage: KubeStorage) { this.client = client; this.storage = storage; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<KubeState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private namespaceEpoch = 0;
  private resetNamespaces() { ++this.namespaceEpoch; this.update({namespaces:undefined}); }
  async listAWSProfiles() {
    const region = this.state.profile?.eks?.region;
    return region ? this.client.listAWSProfiles(region) : [];
  }
  async refreshNamespaces(more = false) {
    if (this.importPending || !this.state.profile || (more && !this.state.namespaces?.cursor)) return;
    const previous = more ? this.state.namespaces : undefined;
    const id = ++this.namespaceEpoch;
    this.update({namespaces:{items:previous?.items ?? [],cursor:previous?.cursor ?? "",status:"loading",message:""}});
    try {
      const raw = await this.storage.load();
      if (id !== this.namespaceEpoch) return;
      if (!raw) throw new Error("config_invalid");
      const result = await this.client.listNamespaces(raw,previous?.cursor ?? "");
      if (id !== this.namespaceEpoch) return;
      this.update({namespaces:{items:[...new Set([...(previous?.items ?? []),...result.items])].sort(),cursor:result.cursor,status:"ready",message:""}});
    } catch(error) { if(id === this.namespaceEpoch) this.update({namespaces:{items:previous?.items ?? [],cursor:previous?.cursor ?? "",status:"error",message:kubeMessage(error)}}); }
  }
  private invalidateReads() {
    ++this.detailEpoch; ++this.logEpoch; ++this.scaleEpoch; ++this.metricsEpoch;
    return ++this.epoch;
  }
  async load() {
    if (this.scalePending || this.importPending) return;
    this.resetNamespaces();
    const id = this.invalidateReads();
    this.update({ status: 'loading', message: '', ...emptyResults });
    try {
      const raw = await this.storage.load();
      if (id !== this.epoch) return;
      if (!raw) { this.update({ status: 'idle', profile: undefined, namespace: '' }); return; }
      const profile = await this.client.inspect(raw);
      if (id === this.epoch) this.update({ status: 'idle', profile, namespace: profile.namespace });
    } catch (error) { if (id === this.epoch) this.update({ status: 'error', message: kubeMessage(error) }); }
  }
  async import(raw: string): Promise<boolean> {
    if (this.importPending || this.scalePending) return false;
    this.importPending = true;
    this.resetNamespaces();
    const id = this.invalidateReads();
    this.update({ status: 'loading', configBusy: true, message: '', ...emptyResults });
    try {
      const profile = await this.client.inspect(raw);
      raw = await this.client.selectContext(raw, profile.context);
      if (id !== this.epoch) return false;
      await this.storage.save(raw);
      if (id !== this.epoch) return false;
      this.update({ status: 'idle', profile, namespace: profile.namespace, message: 'kubeconfig 已匯入。' });
      return true;
    } catch (error) { if (id === this.epoch) this.update({ status: 'error', message: kubeMessage(error) }); return false; }
    finally { this.importPending = false; this.update({ configBusy: false }); }
  }
  async selectContext(name: string): Promise<boolean> {
    if (this.importPending || this.scalePending || this.state.profile?.context === name || !this.state.profile?.contexts?.some(item => item.context === name)) return false;
    return this.changeSelection(raw => this.client.selectContext(raw, name));
  }
  async selectAWSProfile(name: string): Promise<boolean> {
    if (this.importPending || this.scalePending || !this.state.profile?.eks) return false;
    return this.changeSelection(async raw => {
      if (name) {
        const profiles = await this.listAWSProfiles();
        const profile = profiles.find(item => item.name === name);
        if (!profile) throw new Error('aws_login_required');
        if (!profile.enabled) throw new Error('aws_profile_disabled');
      }
      return this.client.selectAWSProfile(raw, name);
    });
  }
  private async changeSelection(select: (raw:string)=>Promise<string>): Promise<boolean> {
    this.importPending = true;
    this.resetNamespaces();
    const id = this.invalidateReads();
    this.update({ status: 'loading', configBusy: true, message: '', ...emptyResults });
    try {
      const raw = await this.storage.load();
      if (!raw) throw new Error('config_invalid');
      const selected = await select(raw);
      const profile = await this.client.inspect(selected);
      if (id !== this.epoch) return false;
      await this.storage.save(selected);
      if (id !== this.epoch) return false;
      this.update({ status: 'idle', profile, namespace: profile.namespace, message: '' });
      return true;
    } catch (error) {
      if (id === this.epoch) this.update({ status: 'error', message: kubeMessage(error) });
      return false;
    } finally { this.importPending = false; this.update({ configBusy: false }); }
  }
  setNamespace(namespace: string) {
    if (this.importPending || this.scalePending) return;
    this.invalidateReads();
    this.update({ namespace, ...emptyResults, status: 'idle', message: '' });
  }
  setKind(kind: ResourceKind) {
    if (this.importPending || this.scalePending || kind === this.state.kind) return;
    this.invalidateReads();
    this.update({ kind, ...emptyResults, status: 'idle', message: '' });
  }
  closeMetrics() { ++this.metricsEpoch; this.update({ metrics: undefined }); }
  async openMetrics(pod: string) {
    if (this.importPending || this.scalePending || this.state.kind !== 'pods' || this.state.status !== 'ready' || !this.state.pods.some(item => item.name === pod)) return;
    const id = ++this.metricsEpoch;
    const namespace = this.state.namespace.trim();
    this.update({ metrics: { pod, status: 'loading', message: '' } });
    try {
      const raw = await this.storage.load();
      if (id !== this.metricsEpoch) return;
      if (!raw) throw new Error('config_invalid');
      const value = await this.client.getPodMetrics(raw, namespace, pod);
      if (id === this.metricsEpoch) this.update({ metrics: { pod, value, status: 'ready', message: '' } });
    } catch (error) { if (id === this.metricsEpoch) this.update({ metrics: { pod, status: 'error', message: kubeMessage(error) } }); }
  }
  closeScale() {
    ++this.scaleEpoch;
    this.update({ scale: undefined, ...(this.scalePending ? { scaleNotice: '變更處理中，關閉畫面不會撤回已送出的變更。' } : {}) });
  }
  async openScale(name: string) {
    const { kind, profile, namespace } = this.state;
    if (this.importPending || this.scalePending || !profile || (kind !== 'deployments' && kind !== 'statefulsets') || (this.state.scale?.name !== name && (this.state.status !== 'ready' || !this.state.resources.some(item => item.name === name)))) return;
    const id = ++this.scaleEpoch;
    const panel: ScalePanelState = { name, kind, namespace: namespace.trim(), cluster: profile.cluster, context: profile.context, input: '', message: '', status: 'loading' };
    this.update({ scale: panel });
    try {
      const raw = await this.storage.load();
      if (id !== this.scaleEpoch) return;
      if (!raw) throw new Error('config_invalid');
      const value = await this.client.getScale(raw, panel.namespace, kind, name);
      if (id === this.scaleEpoch) this.update({ scale: { ...panel, value, input: String(value.replicas), status: 'editing' } });
    } catch (error) { if (id === this.scaleEpoch) this.update({ scale: { ...panel, status: 'error', message: kubeMessage(error) } }); }
  }
  setScaleReplicas(input: string) {
    const panel = this.state.scale;
    if (panel?.status === 'editing') this.update({ scale: { ...panel, input, message: '' } });
  }
  reviewScale() {
    const panel = this.state.scale;
    if (panel?.status !== 'editing' || !panel.value) return;
    if (!/^\d+$/.test(panel.input) || Number(panel.input) > 2147483647) {
      this.update({ scale: { ...panel, message: messages.invalid_scale } }); return;
    }
    if (Number(panel.input) === panel.value.replicas) {
      this.update({ scale: { ...panel, message: '副本數沒有變更。' } }); return;
    }
    this.update({ scale: { ...panel, status: 'confirming', message: '' } });
  }
  editScale() {
    const panel = this.state.scale;
    if (panel?.status === 'confirming') this.update({ scale: { ...panel, status: 'editing' } });
  }
  async submitScale() {
    const panel = this.state.scale;
    if (panel?.status !== 'confirming' || !panel.value || this.scalePending || this.importPending) return;
    const id = this.scaleEpoch;
    this.scalePending = true;
    this.update({ scale: { ...panel, status: 'submitting' } });
    let sent = false;
    let outcome = '';
    try {
      const raw = await this.storage.load();
      if (id !== this.scaleEpoch) return;
      if (!raw) throw new Error('config_invalid');
      sent = true;
      const value = await this.client.updateScale(raw, panel.namespace, panel.kind, panel.name, { ...panel.value, replicas: Number(panel.input) });
      outcome = `叢集已接受期望副本數 ${value.replicas}，不代表已就緒；請重新查詢。`;
      if (id === this.scaleEpoch) this.update({ scale: { ...panel, value, status: 'success', message: outcome } });
    } catch (error) {
      outcome = error instanceof Error && /(?:^|[^a-z_])forbidden(?:$|[^a-z_])/.test(error.message)
        ? '此帳號沒有調整副本數的權限。' : kubeMessage(error);
      if (sent && outcome === '操作失敗，請檢查設定後重試。') outcome = messages.scale_unknown;
      if (id === this.scaleEpoch) this.update({ scale: { ...panel, status: 'error', message: outcome } });
    } finally {
      this.scalePending = false;
      if (!sent) this.update({ scaleNotice: undefined });
      // 已送出的寫入不能由關閉面板取消；移除過期清單，保留結果提示。
      if (sent) {
        ++this.epoch;
        this.update({ resources: [], hasMore: false, status: 'idle', scaleNotice: outcome });
      }
    }
  }
  closeDetail() { ++this.detailEpoch; this.update(emptyDetail); }
  async openConfigMap(name: string) {
    if (this.importPending || this.state.kind !== 'configmaps' || this.state.status !== 'ready' || !this.state.resources.some(item => item.name === name)) return;
    const id = ++this.detailEpoch;
    const { namespace } = this.state;
    this.update({ ...emptyDetail, detailName: name, detailStatus: 'loading' });
    try {
      const raw = await this.storage.load();
      if (!raw) throw new Error('config_invalid');
      if (id !== this.detailEpoch) return;
      const detail = await this.client.getConfigMap(raw, namespace.trim(), name);
      if (id === this.detailEpoch) this.update({ detail, detailStatus: 'ready' });
    } catch (error) { if (id === this.detailEpoch) this.update({ detailStatus: 'error', detailMessage: kubeMessage(error) }); }
  }
  closeLogs() { ++this.logEpoch; this.update({ logs: undefined }); }
  async openPodLogs(pod: string) {
    if (this.importPending || this.state.kind !== 'pods' || this.state.status !== 'ready' || !this.state.pods.some(item => item.name === pod)) return;
    const id = ++this.logEpoch;
    const namespace = this.state.namespace.trim();
    this.update({ logs: { pod, containers: [], container: '', previous: false, text: '', truncated: false, optionsStatus: 'loading', status: 'idle', message: '' } });
    try {
      const raw = await this.storage.load();
      if (!raw) throw new Error('config_invalid');
      if (id !== this.logEpoch) return;
      const options = await this.client.getPodContainers(raw, namespace, pod);
      if (id !== this.logEpoch) return;
      if (!options.containers.length) throw new Error('api_failed');
      this.update({ logs: { ...this.state.logs!, containers: options.containers, container: options.containers[0].name, optionsStatus: 'ready' } });
      await this.refreshLogs();
    } catch (error) {
      if (id === this.logEpoch && this.state.logs) this.update({ logs: { ...this.state.logs, optionsStatus: 'error', message: kubeMessage(error) } });
    }
  }
  async selectLogContainer(container: string) {
    const logs = this.state.logs;
    if (!logs || logs.optionsStatus !== 'ready' || !logs.containers.some(item => item.name === container)) return;
    ++this.logEpoch;
    this.update({ logs: { ...logs, container, text: '', truncated: false, status: 'idle', message: '' } });
    await this.refreshLogs();
  }
  async setPreviousLogs(previous: boolean) {
    const logs = this.state.logs;
    if (!logs || logs.optionsStatus !== 'ready') return;
    ++this.logEpoch;
    this.update({ logs: { ...logs, previous, text: '', truncated: false, status: 'idle', message: '' } });
    await this.refreshLogs();
  }
  async refreshLogs() {
    const logs = this.state.logs;
    if (!logs || logs.optionsStatus !== 'ready' || this.importPending) return;
    const id = ++this.logEpoch;
    const namespace = this.state.namespace.trim();
    this.update({ logs: { ...logs, text: '', truncated: false, status: 'loading', message: '' } });
    try {
      const raw = await this.storage.load();
      if (!raw) throw new Error('config_invalid');
      if (id !== this.logEpoch) return;
      const result = await this.client.getPodLogs(raw, namespace, logs.pod, logs.container, logs.previous);
      if (id === this.logEpoch) this.update({ logs: { ...logs, ...result, status: 'ready', message: '' } });
    } catch (error) {
      if (id === this.logEpoch) this.update({ logs: { ...logs, text: '', truncated: false, status: 'error', message: kubeMessage(error) } });
    }
  }
  private async loadListMetrics(raw:string,namespace:string,id:number) {
    try {
      const metrics=await this.client.listPodMetrics(raw,namespace);
      if(id===this.epoch) this.update({listMetrics:metrics,listMetricsMessage:Object.keys(metrics).length?'':'用量暫無資料'});
    } catch { if(id===this.epoch) this.update({listMetrics:undefined,listMetricsMessage:'用量暫無資料'}); }
  }
  async refresh() {
    if (this.importPending || this.scalePending) return;
    const id = this.invalidateReads();
    const { profile, namespace, kind } = this.state;
    if (!profile) { this.update({ status: 'error', message: '請先在設定匯入 kubeconfig。' }); return; }
    this.update({ status: 'loading', ...emptyResults, message: '' });
    try {
      const raw = await this.storage.load();
      if (!raw) throw new Error('config_invalid');
      if (id !== this.epoch) return;
      if (kind === 'pods') {
        const result = await this.client.listPods(raw, namespace.trim());
        if (id === this.epoch) {
 this.update({ status: 'ready', pods: result.items, hasMore: result.hasMore, updatedAt: Date.now() });
 if (result.items.length) void this.loadListMetrics(raw,namespace.trim(),id);
 }
      } else {
        const result = await this.client.listResources(raw, namespace.trim(), kind);
        if (id === this.epoch) this.update({ status: 'ready', resources: result.items, hasMore: result.hasMore, updatedAt: Date.now() });
      }
    } catch (error) { if (id === this.epoch) this.update({ status: 'error', message: kubeMessage(error) }); }
  }
}
