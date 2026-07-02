package kubernetes

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/shared/dto"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

// newTestRESTMapper 建立測試用的 RESTMapper，只登記測試會用到的 GVK 與 scope。
// 未登記的 GVK 會回傳 NoMatchError，用於驗證「找不到資源類型」路徑。
func newTestRESTMapper() meta.RESTMapper {
	m := meta.NewDefaultRESTMapper(nil)
	m.Add(schema.GroupVersionKind{Version: "v1", Kind: "Pod"}, meta.RESTScopeNamespace)
	m.Add(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, meta.RESTScopeNamespace)
	m.Add(schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "ClusterWidget"}, meta.RESTScopeRoot)
	return m
}

// 測試用 dynamic client 的 GVR→ListKind 對映（unstructured 建立需要）。
var testDynamicListKinds = map[schema.GroupVersionResource]string{
	{Version: "v1", Resource: "pods"}:                                 "PodList",
	{Version: "v1", Resource: "secrets"}:                              "SecretList",
	{Version: "v1", Resource: "namespaces"}:                           "NamespaceList",
	{Group: "apps", Version: "v1", Resource: "deployments"}:           "DeploymentList",
	{Group: "example.com", Version: "v1", Resource: "clusterwidgets"}: "ClusterWidgetList",
}

func newTestDynamicClient() *dynamicfake.FakeDynamicClient {
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), testDynamicListKinds)
}

func createServiceWithDynamic(dyn dynamic.Interface) *Service {
	return &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{dynamic: dyn, restMapper: newTestRESTMapper()},
	}
}

func TestCreateResourceNamespacedCreate(t *testing.T) {
	dyn := newTestDynamicClient()
	service := createServiceWithDynamic(dyn)
	content := "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example\n  namespace: custom\n"
	result, err := service.CreateResource(context.Background(), dto.KubernetesResourceCreateRequest{
		ResourceType: "Pod", Namespace: "default", YAML: content,
	})
	if err != nil {
		t.Fatalf("CreateResource() error = %v", err)
	}
	if result.APIVersion != "v1" || result.Kind != "Pod" || result.Name != "example" || result.Namespace != "custom" {
		t.Fatalf("CreateResource() = %+v", result)
	}
	actions := dyn.Actions()
	if len(actions) != 1 || actions[0].GetVerb() != "create" ||
		actions[0].GetResource() != (schema.GroupVersionResource{Version: "v1", Resource: "pods"}) ||
		actions[0].GetNamespace() != "custom" {
		t.Fatalf("Create action = %+v", actions)
	}
}

// YAML 未寫 namespace 時，namespaced 資源應以 request.Namespace 作為 fallback 注入。
func TestCreateResourceInjectsNamespaceFallback(t *testing.T) {
	dyn := newTestDynamicClient()
	service := createServiceWithDynamic(dyn)
	content := "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example\n"
	result, err := service.CreateResource(context.Background(), dto.KubernetesResourceCreateRequest{
		ResourceType: "Pod", Namespace: "fallback-ns", YAML: content,
	})
	if err != nil {
		t.Fatalf("CreateResource() error = %v", err)
	}
	if result.Namespace != "fallback-ns" {
		t.Fatalf("CreateResource() namespace = %q, want fallback-ns", result.Namespace)
	}
	if actions := dyn.Actions(); len(actions) != 1 || actions[0].GetNamespace() != "fallback-ns" {
		t.Fatalf("Create action = %+v", actions)
	}
}

// cluster-scoped 資源不應注入 namespace（createDynamicResource 以 namespace="" 呼叫）。
func TestCreateDynamicResourceClusterScoped(t *testing.T) {
	dyn := newTestDynamicClient()
	clients := &clusterClients{dynamic: dyn}
	mapping := &meta.RESTMapping{
		Resource:         schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "clusterwidgets"},
		GroupVersionKind: schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "ClusterWidget"},
		Scope:            meta.RESTScopeRoot,
	}
	content := []byte("apiVersion: example.com/v1\nkind: ClusterWidget\nmetadata:\n  name: widget\n")
	result, err := createDynamicResource(context.Background(), clients, mapping, "", content)
	if err != nil {
		t.Fatalf("createDynamicResource() error = %v", err)
	}
	if result.Name != "widget" || result.Namespace != "" {
		t.Fatalf("createDynamicResource() = %+v", result)
	}
	if actions := dyn.Actions(); len(actions) != 1 || actions[0].GetNamespace() != "" {
		t.Fatalf("Create action = %+v", actions)
	}
}

// UpdateResource 套用整份 YAML → dynamic Update action（namespaced）。
func TestUpdateResourceAppliesYAML(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1", "kind": "Pod",
		"metadata": map[string]interface{}{"name": "example", "namespace": "custom", "resourceVersion": "1"},
	}}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), testDynamicListKinds, obj)
	service := createServiceWithDynamic(dyn)
	content := "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example\n  namespace: custom\n  resourceVersion: \"1\"\n"
	result, err := service.UpdateResource(context.Background(), dto.KubernetesResourceUpdateRequest{Namespace: "default", YAML: content})
	if err != nil {
		t.Fatalf("UpdateResource() error = %v", err)
	}
	if result.Kind != "Pod" || result.Name != "example" || result.Namespace != "custom" {
		t.Fatalf("UpdateResource() = %+v", result)
	}
	actions := dyn.Actions()
	if len(actions) != 1 || actions[0].GetVerb() != "update" ||
		actions[0].GetResource() != (schema.GroupVersionResource{Version: "v1", Resource: "pods"}) ||
		actions[0].GetNamespace() != "custom" {
		t.Fatalf("Update action = %+v", actions)
	}
}

// Conflict（樂觀鎖）時回傳「重新載入」的中文訊息，且不洩漏底層內容。
func TestUpdateResourceConflictReturnsReloadHint(t *testing.T) {
	dyn := newTestDynamicClient()
	dyn.PrependReactor("update", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewConflict(schema.GroupResource{Resource: "pods"}, "example", errors.New("resourceVersion mismatch token=secret-token"))
	})
	_, err := createServiceWithDynamic(dyn).UpdateResource(context.Background(), dto.KubernetesResourceUpdateRequest{
		Namespace: "default", YAML: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example\n  namespace: custom\n",
	})
	if err == nil || !strings.Contains(err.Error(), "請重新載入") || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("UpdateResource() error = %v", err)
	}
}

func TestCreateResourceValidatesYAMLAndSelection(t *testing.T) {
	service := createServiceWithDynamic(newTestDynamicClient())
	tests := []struct {
		name    string
		request dto.KubernetesResourceCreateRequest
		want    string
	}{
		{"empty", dto.KubernetesResourceCreateRequest{ResourceType: "Pod"}, "不可為空"},
		{"missing apiVersion/kind", dto.KubernetesResourceCreateRequest{ResourceType: "Pod", YAML: "metadata:\n  name: app"}, "必須包含 apiVersion 與 kind"},
		{"missing name", dto.KubernetesResourceCreateRequest{ResourceType: "Pod", YAML: "apiVersion: v1\nkind: Pod\nmetadata: {}"}, "metadata.name"},
		{"unsupported", dto.KubernetesResourceCreateRequest{ResourceType: "Namespace", YAML: "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: demo"}, "不支援"},
		{"no kind match", dto.KubernetesResourceCreateRequest{ResourceType: "Secret", Namespace: "default", YAML: "apiVersion: v1\nkind: Secret\nmetadata:\n  name: s"}, "找不到此資源類型"},
		{"multiple documents", dto.KubernetesResourceCreateRequest{ResourceType: "Pod", YAML: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: a\n---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: b"}, "一次只能"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.CreateResource(context.Background(), test.request)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("CreateResource() error = %v", err)
			}
		})
	}
}

func TestCreateResourceLimitsYAMLSize(t *testing.T) {
	_, err := createServiceWithDynamic(newTestDynamicClient()).CreateResource(context.Background(), dto.KubernetesResourceCreateRequest{
		ResourceType: "Pod", YAML: strings.Repeat("x", maxKubernetesResourceYAMLBytes+1),
	})
	if err == nil || !strings.Contains(err.Error(), "1 MiB") {
		t.Fatalf("CreateResource() error = %v", err)
	}
}

// API Server 拒絕（Forbidden）時，錯誤訊息不可洩漏底層敏感內容（如 token）。
func TestCreateResourceMasksRBACErrors(t *testing.T) {
	dyn := newTestDynamicClient()
	dyn.PrependReactor("create", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "app", errors.New("token=secret-token"))
	})
	_, err := createServiceWithDynamic(dyn).CreateResource(context.Background(), dto.KubernetesResourceCreateRequest{
		ResourceType: "Pod", Namespace: "default", YAML: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: app",
	})
	if err == nil || !strings.Contains(err.Error(), "沒有建立權限") || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("CreateResource() error = %v", err)
	}
}

// 欄位未通過 API Server 驗證（BadRequest/Invalid）時轉為通用中文訊息。
func TestCreateResourceMasksInvalidFields(t *testing.T) {
	dyn := newTestDynamicClient()
	dyn.PrependReactor("create", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewBadRequest("strict decoding error: unknown field \"spec.bogus\"")
	})
	_, err := createServiceWithDynamic(dyn).CreateResource(context.Background(), dto.KubernetesResourceCreateRequest{
		ResourceType: "Pod", Namespace: "default", YAML: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: app",
	})
	if err == nil || !strings.Contains(err.Error(), "未通過 Kubernetes API 驗證") || strings.Contains(err.Error(), "spec.bogus") {
		t.Fatalf("CreateResource() error = %v", err)
	}
}
