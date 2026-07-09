package app

import (
	"encoding/json"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// kubernetesSetting 讀取 AppSettings 中的字串設定（kubeconfigPath / defaultNamespace）；
// 讀取失敗、缺鍵或非字串一律回傳空字串（呼叫端據此回退預設行為）。
func (a *App) kubernetesSetting(key string) string {
	settings, err := a.hostVault.GetSettings(a.contextOrBackground())
	if err != nil {
		return ""
	}
	raw, ok := settings[key]
	if !ok {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func (a *App) ListKubernetesClusters() ([]KubernetesClusterProfile, error) {
	return a.kubernetes.List(a.ctx, a.kubernetesSetting("kubeconfigPath"))
}

func (a *App) SaveKubernetesCluster(profile KubernetesClusterProfile) (KubernetesClusterProfile, error) {
	return a.kubernetes.Save(a.ctx, profile)
}

// DeleteKubernetesCluster 只刪除 TermiX 中繼資料，不會刪除 kubeconfig 的 Context。
func (a *App) DeleteKubernetesCluster(id string) error {
	return a.kubernetes.Delete(a.ctx, id)
}

func (a *App) SwitchKubernetesContext(request KubernetesContextSwitchRequest) error {
	return a.kubernetes.SwitchContext(request.KubeconfigPath, request.ContextName)
}

func (a *App) ConnectKubernetesCluster(request KubernetesConnectRequest) (KubernetesSession, error) {
	// 該 cluster 未指定 namespace 時，套用設定中的全域預設 namespace 作為 session（操作用）預設。
	// '*'（All Namespaces）為初始篩選偏好、非真實 namespace，不應寫入 session，故略過。
	if strings.TrimSpace(request.Namespace) == "" {
		if ns := a.kubernetesSetting("defaultNamespace"); ns != "*" {
			request.Namespace = ns
		}
	}
	return a.kubernetes.Connect(request)
}

func (a *App) DisconnectKubernetesCluster() {
	a.kubernetes.Disconnect()
}

func (a *App) GetActiveKubernetesSession() *KubernetesSession {
	return a.kubernetes.GetActiveSession()
}

func (a *App) GetKubernetesDashboard(request KubernetesDashboardRequest) (KubernetesDashboardSnapshot, error) {
	return a.kubernetes.Dashboard(a.contextOrBackground(), request)
}

func (a *App) GetKubernetesNamespaces() ([]string, error) {
	return a.kubernetes.ListNamespaces(a.contextOrBackground())
}

func (a *App) GetKubernetesResourceDetail(request KubernetesResourceDetailRequest) (KubernetesResourceDetail, error) {
	return a.kubernetes.ResourceDetail(a.contextOrBackground(), request)
}

func (a *App) GetKubernetesPodLogs(request KubernetesPodLogsRequest) (KubernetesPodLogs, error) {
	return a.kubernetes.PodLogs(a.contextOrBackground(), request)
}

func (a *App) StartKubernetesPodShell(request KubernetesPodShellStartRequest) (KubernetesPodShellSession, error) {
	return a.kubernetes.StartPodShell(a.contextOrBackground(), request,
		func(sessionID, data string) {
			runtime.EventsEmit(a.ctx, "kubernetes-shell-output", map[string]string{"sessionId": sessionID, "data": data})
		},
		func(sessionID, message string) {
			runtime.EventsEmit(a.ctx, "kubernetes-shell-closed", map[string]string{"sessionId": sessionID, "error": message})
		},
	)
}

func (a *App) WriteKubernetesPodShellInput(request KubernetesPodShellSessionRequest) error {
	return a.kubernetes.WritePodShell(request)
}

func (a *App) ResizeKubernetesPodShell(request KubernetesPodShellSessionRequest) error {
	return a.kubernetes.ResizePodShell(request)
}

func (a *App) CloseKubernetesPodShell(sessionID string) {
	a.kubernetes.ClosePodShell(sessionID)
}

func (a *App) DeleteKubernetesPod(request KubernetesPodDeleteRequest) error {
	return a.kubernetes.DeletePod(a.contextOrBackground(), request)
}

func (a *App) DeleteKubernetesResource(request KubernetesResourceDeleteRequest) error {
	return a.kubernetes.DeleteResource(a.contextOrBackground(), request)
}

func (a *App) StartKubernetesPodPortForward(request KubernetesPodPortForwardRequest) (KubernetesPodPortForward, error) {
	return a.kubernetes.StartPodPortForward(a.contextOrBackground(), request)
}

func (a *App) ListKubernetesPodPortForwards(request KubernetesPodPortForwardListRequest) []KubernetesPodPortForward {
	return a.kubernetes.ListPodPortForwards(request)
}

func (a *App) StopKubernetesPodPortForward(request KubernetesPodPortForwardStopRequest) error {
	return a.kubernetes.StopPodPortForward(request.ID)
}

func (a *App) StartKubernetesServicePortForward(request KubernetesServicePortForwardRequest) (KubernetesPodPortForward, error) {
	return a.kubernetes.StartServicePortForward(a.contextOrBackground(), request)
}

func (a *App) ListKubernetesServicePortForwards(request KubernetesServicePortForwardListRequest) []KubernetesPodPortForward {
	return a.kubernetes.ListServicePortForwards(request)
}

func (a *App) CreateKubernetesResource(request KubernetesResourceCreateRequest) (KubernetesResourceCreateResult, error) {
	return a.kubernetes.CreateResource(a.contextOrBackground(), request)
}

func (a *App) UpdateKubernetesResource(request KubernetesResourceUpdateRequest) (KubernetesResourceCreateResult, error) {
	return a.kubernetes.UpdateResource(a.contextOrBackground(), request)
}
