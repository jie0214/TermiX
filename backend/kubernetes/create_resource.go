package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jie0214/TermiX/shared/dto"

	yamlv3 "gopkg.in/yaml.v3"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"
)

const maxKubernetesResourceYAMLBytes = 1024 * 1024

type createResourceHeader struct {
	APIVersion string `yaml:"apiVersion"`
	Kind       string `yaml:"kind"`
	Metadata   struct {
		Name      string `yaml:"name"`
		Namespace string `yaml:"namespace"`
	} `yaml:"metadata"`
}

// creatableGroupKinds 是允許透過 Create Resource 建立的資源白名單（資料驅動）。
// 以 GroupKind 為 key（忽略 version 較穩健）；新增一種可建立資源只需在此加一行，
// 實際建立走泛用 dynamic client + RESTMapper，不需逐 kind 寫死 typed 程式。
// 建立與否最終仍由叢集 RBAC 把關，此白名單為額外的安全邊界與 UX curation。
var creatableGroupKinds = map[schema.GroupKind]struct{}{
	{Group: "", Kind: "Pod"}:                                  {},
	{Group: "apps", Kind: "Deployment"}:                       {},
	{Group: "apps", Kind: "ReplicaSet"}:                       {},
	{Group: "", Kind: "ReplicationController"}:                {},
	{Group: "apps", Kind: "DaemonSet"}:                        {},
	{Group: "apps", Kind: "StatefulSet"}:                      {},
	{Group: "batch", Kind: "Job"}:                             {},
	{Group: "batch", Kind: "CronJob"}:                         {},
	{Group: "", Kind: "Service"}:                              {},
	{Group: "", Kind: "ConfigMap"}:                            {},
	{Group: "", Kind: "Secret"}:                               {},
	{Group: "networking.k8s.io", Kind: "Ingress"}:             {},
	{Group: "networking.k8s.io", Kind: "NetworkPolicy"}:       {},
	{Group: "", Kind: "PersistentVolumeClaim"}:                {},
	{Group: "", Kind: "ServiceAccount"}:                       {},
	{Group: "rbac.authorization.k8s.io", Kind: "Role"}:        {},
	{Group: "rbac.authorization.k8s.io", Kind: "RoleBinding"}: {},
	{Group: "autoscaling", Kind: "HorizontalPodAutoscaler"}:   {},
	{Group: "policy", Kind: "PodDisruptionBudget"}:            {},
	{Group: "", Kind: "ResourceQuota"}:                        {},
}

func isCreatableGVK(gvk schema.GroupVersionKind) bool {
	_, ok := creatableGroupKinds[gvk.GroupKind()]
	return ok
}

func (s *Service) CreateResource(ctx context.Context, request dto.KubernetesResourceCreateRequest) (dto.KubernetesResourceCreateResult, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	content := strings.TrimSpace(request.YAML)
	if content == "" {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 不可為空")
	}
	if len(content) > maxKubernetesResourceYAMLBytes {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 不可超過 1 MiB")
	}
	if err := validateSingleYAMLDocument(content); err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	var header createResourceHeader
	if err := yaml.Unmarshal([]byte(content), &header); err != nil {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 格式無效")
	}
	// 權威來源為 YAML header 的 GVK（不依賴 request.ResourceType），
	// type 與 YAML 不符的問題自然消失。
	gvk, err := parseCreateGVK(header)
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	if strings.TrimSpace(header.Metadata.Name) == "" {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource metadata.name 不可為空")
	}
	if !isCreatableGVK(gvk) {
		return dto.KubernetesResourceCreateResult{}, errors.New("不支援建立此 Kubernetes 資源類型")
	}
	if clients.dynamic == nil || clients.restMapper == nil {
		return dto.KubernetesResourceCreateResult{}, errors.New("目前連線不支援動態建立資源")
	}

	mapping, err := resolveRESTMapping(clients.restMapper, gvk)
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, resourceCreateError(gvk.Kind, err)
	}

	// namespace 僅對 namespaced scope 要求/套用；cluster-scoped 不可帶（帶了會被 API Server 拒）。
	namespace := strings.TrimSpace(header.Metadata.Namespace)
	if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
		if namespace == "" {
			namespace = effectiveNamespace(request.Namespace, session.Namespace)
		}
		if namespace == metav1.NamespaceAll || namespace == "" {
			return dto.KubernetesResourceCreateResult{}, errors.New("建立 Kubernetes Resource 時必須指定 Namespace")
		}
	} else {
		namespace = ""
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, err := createDynamicResource(ctx, clients, mapping, namespace, []byte(content))
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, resourceCreateError(gvk.Kind, err)
	}
	return result, nil
}

// parseCreateGVK 由 header 的 apiVersion+kind 解析出 GroupVersionKind。
// apiVersion 或 kind 缺失時回傳明確錯誤，避免後續 RESTMapper 得到無意義的空 GVK。
func parseCreateGVK(header createResourceHeader) (schema.GroupVersionKind, error) {
	apiVersion := strings.TrimSpace(header.APIVersion)
	kind := strings.TrimSpace(header.Kind)
	if apiVersion == "" || kind == "" {
		return schema.GroupVersionKind{}, errors.New("Kubernetes Resource YAML 必須包含 apiVersion 與 kind")
	}
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return schema.GroupVersionKind{}, errors.New("Kubernetes Resource YAML 的 apiVersion 格式無效")
	}
	return gv.WithKind(kind), nil
}

// requestGVK 由 request 的 apiVersion+kind 解析出 GroupVersionKind。
// 供 detail/delete 泛用路徑使用；apiVersion 空時回傳明確錯誤（前端一定會傳）。
func requestGVK(apiVersion, kind string) (schema.GroupVersionKind, error) {
	apiVersion = strings.TrimSpace(apiVersion)
	kind = strings.TrimSpace(kind)
	if apiVersion == "" || kind == "" {
		return schema.GroupVersionKind{}, errors.New("讀取或操作 Kubernetes 資源時必須提供 apiVersion 與 kind")
	}
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return schema.GroupVersionKind{}, errors.New("Kubernetes 資源 apiVersion 格式無效")
	}
	return gv.WithKind(kind), nil
}

// UpdateResource 套用編輯後的整份 YAML（沿用 Create 的驗證與 GVK 解析，走泛用 dynamic client）。
// 不做 allowlist 限制：可更新任何可解析 GVK，由叢集 RBAC 把關（與 detail/delete 一致）。
func (s *Service) UpdateResource(ctx context.Context, request dto.KubernetesResourceUpdateRequest) (dto.KubernetesResourceCreateResult, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	content := strings.TrimSpace(request.YAML)
	if content == "" {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 不可為空")
	}
	if len(content) > maxKubernetesResourceYAMLBytes {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 不可超過 1 MiB")
	}
	if err := validateSingleYAMLDocument(content); err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	var header createResourceHeader
	if err := yaml.Unmarshal([]byte(content), &header); err != nil {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 格式無效")
	}
	gvk, err := parseCreateGVK(header)
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	if strings.TrimSpace(header.Metadata.Name) == "" {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource metadata.name 不可為空")
	}
	if clients.dynamic == nil || clients.restMapper == nil {
		return dto.KubernetesResourceCreateResult{}, errors.New("目前連線不支援動態更新資源")
	}

	mapping, err := resolveRESTMapping(clients.restMapper, gvk)
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, resourceUpdateError(gvk.Kind, err)
	}

	// namespace 僅對 namespaced scope 套用；cluster-scoped 不可帶。
	namespace := strings.TrimSpace(header.Metadata.Namespace)
	if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
		if namespace == "" {
			namespace = effectiveNamespace(request.Namespace, session.Namespace)
		}
		if namespace == metav1.NamespaceAll || namespace == "" {
			return dto.KubernetesResourceCreateResult{}, errors.New("更新 Kubernetes Resource 時必須指定 Namespace")
		}
	} else {
		namespace = ""
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, err := updateDynamicResource(ctx, clients, mapping, namespace, []byte(content))
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, resourceUpdateError(gvk.Kind, err)
	}
	return result, nil
}

// updateDynamicResource 以 dynamic client 更新資源：把 YAML 轉為 unstructured，
// namespaced scope 才注入 namespace，回傳更新後物件的中繼資料。
func updateDynamicResource(ctx context.Context, clients *clusterClients, mapping *meta.RESTMapping, namespace string, content []byte) (dto.KubernetesResourceCreateResult, error) {
	obj := &unstructured.Unstructured{}
	if err := yaml.Unmarshal(content, &obj.Object); err != nil {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 格式無效")
	}

	resource := clients.dynamic.Resource(mapping.Resource)
	var updated *unstructured.Unstructured
	var err error
	if namespace != "" {
		obj.SetNamespace(namespace)
		updated, err = resource.Namespace(namespace).Update(ctx, obj, metav1.UpdateOptions{})
	} else {
		updated, err = resource.Update(ctx, obj, metav1.UpdateOptions{})
	}
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	return dto.KubernetesResourceCreateResult{
		APIVersion: updated.GetAPIVersion(),
		Kind:       updated.GetKind(),
		Name:       updated.GetName(),
		Namespace:  updated.GetNamespace(),
	}, nil
}

func resourceUpdateError(kind string, err error) error {
	if meta.IsNoMatchError(err) {
		return fmt.Errorf("更新 %s 失敗：叢集中找不到此資源類型", kind)
	}
	switch {
	case apierrors.IsConflict(err):
		return fmt.Errorf("更新 %s 失敗：資源已被他人修改，請重新載入後再套用", kind)
	case apierrors.IsForbidden(err):
		return fmt.Errorf("更新 %s 失敗：目前 kubeconfig 身分沒有更新權限", kind)
	case apierrors.IsUnauthorized(err):
		return fmt.Errorf("更新 %s 失敗：Kubernetes 認證已失效", kind)
	case apierrors.IsNotFound(err):
		return fmt.Errorf("更新 %s 失敗：找不到指定資源", kind)
	case apierrors.IsInvalid(err), apierrors.IsBadRequest(err):
		return fmt.Errorf("更新 %s 失敗：YAML 欄位未通過 Kubernetes API 驗證", kind)
	default:
		return fmt.Errorf("更新 %s 失敗：請檢查網路、API Server 與 kubeconfig 認證設定", kind)
	}
}

// resolveRESTMapping 把 GVK 對映到 RESTMapping（含 GVR 與 scope）。
// mapping miss（例如剛安裝的 CRD 尚未在快取中）時 Reset 快取後重試一次。
func resolveRESTMapping(mapper meta.RESTMapper, gvk schema.GroupVersionKind) (*meta.RESTMapping, error) {
	mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil && meta.IsNoMatchError(err) {
		if resettable, ok := mapper.(interface{ Reset() }); ok {
			resettable.Reset()
			mapping, err = mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		}
	}
	return mapping, err
}

// createDynamicResource 以 dynamic client 建立資源：把 YAML 轉為 unstructured，
// namespaced scope 才注入 namespace，回傳實際建立後物件的中繼資料。
func createDynamicResource(ctx context.Context, clients *clusterClients, mapping *meta.RESTMapping, namespace string, content []byte) (dto.KubernetesResourceCreateResult, error) {
	obj := &unstructured.Unstructured{}
	if err := yaml.Unmarshal(content, &obj.Object); err != nil {
		return dto.KubernetesResourceCreateResult{}, errors.New("Kubernetes Resource YAML 格式無效")
	}

	resource := clients.dynamic.Resource(mapping.Resource)
	var created *unstructured.Unstructured
	var err error
	if namespace != "" {
		obj.SetNamespace(namespace)
		created, err = resource.Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
	} else {
		created, err = resource.Create(ctx, obj, metav1.CreateOptions{})
	}
	if err != nil {
		return dto.KubernetesResourceCreateResult{}, err
	}
	return dto.KubernetesResourceCreateResult{
		APIVersion: created.GetAPIVersion(),
		Kind:       created.GetKind(),
		Name:       created.GetName(),
		Namespace:  created.GetNamespace(),
	}, nil
}

func validateSingleYAMLDocument(content string) error {
	decoder := yamlv3.NewDecoder(strings.NewReader(content))
	var first yamlv3.Node
	if err := decoder.Decode(&first); err != nil {
		return errors.New("Kubernetes Resource YAML 格式無效")
	}
	var second yamlv3.Node
	if err := decoder.Decode(&second); err != io.EOF {
		return errors.New("一次只能建立一個 Kubernetes Resource")
	}
	return nil
}

func resourceCreateError(kind string, err error) error {
	if meta.IsNoMatchError(err) {
		return fmt.Errorf("建立 %s 失敗：叢集中找不到此資源類型", kind)
	}
	switch {
	case apierrors.IsForbidden(err):
		return fmt.Errorf("建立 %s 失敗：目前 kubeconfig 身分沒有建立權限", kind)
	case apierrors.IsUnauthorized(err):
		return fmt.Errorf("建立 %s 失敗：Kubernetes 認證已失效", kind)
	case apierrors.IsAlreadyExists(err):
		return fmt.Errorf("建立 %s 失敗：同名資源已存在", kind)
	case apierrors.IsInvalid(err), apierrors.IsBadRequest(err):
		return fmt.Errorf("建立 %s 失敗：YAML 欄位未通過 Kubernetes API 驗證", kind)
	default:
		return fmt.Errorf("建立 %s 失敗：請檢查網路、API Server 與 kubeconfig 認證設定", kind)
	}
}
