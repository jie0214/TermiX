package kubernetes

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

func TestDashboard包含Networking與Storage摘要(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "service-b", Namespace: "default"}, Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.2"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "service-a", Namespace: "default"}, Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.1"}},
		&networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "ingress-a", Namespace: "default"}, Spec: networkingv1.IngressSpec{Rules: []networkingv1.IngressRule{{Host: "app.example.test"}}}},
		&corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "claim-a", Namespace: "default"}, Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound, Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")}}},
		&corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "volume-b"}, Spec: corev1.PersistentVolumeSpec{Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")}}},
		&corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "volume-a"}, Spec: corev1.PersistentVolumeSpec{Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("20Gi")}}},
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "standard"}, Provisioner: "example.test/csi"},
	)

	snapshot, err := newDashboardService(client, nil).Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"})
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	if len(snapshot.Services) != 2 || snapshot.Services[0].Name != "service-a" || snapshot.Overview.Services != 2 {
		t.Fatalf("Services 摘要或排序錯誤：%+v", snapshot.Services)
	}
	if len(snapshot.Ingresses) != 1 || snapshot.Ingresses[0].Hosts != "app.example.test" {
		t.Fatalf("Ingresses 摘要錯誤：%+v", snapshot.Ingresses)
	}
	if len(snapshot.PersistentVolumeClaims) != 1 || snapshot.PersistentVolumeClaims[0].Capacity != "10Gi" {
		t.Fatalf("PVC 摘要錯誤：%+v", snapshot.PersistentVolumeClaims)
	}
	if len(snapshot.PersistentVolumes) != 2 || snapshot.PersistentVolumes[0].Name != "volume-a" || len(snapshot.StorageClasses) != 1 {
		t.Fatalf("Cluster scope Storage 摘要或排序錯誤：PV=%+v SC=%+v", snapshot.PersistentVolumes, snapshot.StorageClasses)
	}
	if len(snapshot.ResourceErrors) != 0 {
		t.Fatalf("ResourceErrors = %+v", snapshot.ResourceErrors)
	}
	wantNamespaces := map[string]string{
		"services": "default", "ingresses": "default", "persistentvolumeclaims": "default",
		"persistentvolumes": "", "storageclasses": "",
	}
	for _, action := range client.Actions() {
		if action.GetVerb() != "list" {
			continue
		}
		want, found := wantNamespaces[action.GetResource().Resource]
		if found && action.GetNamespace() != want {
			t.Fatalf("%s list Namespace = %q，want %q", action.GetResource().Resource, action.GetNamespace(), want)
		}
	}
}

func TestDashboard資源權限不足時個別降級(t *testing.T) {
	tests := []struct{ resource, errorKey string }{
		{resource: "services", errorKey: "services"},
		{resource: "ingresses", errorKey: "ingresses"},
		{resource: "persistentvolumeclaims", errorKey: "persistentVolumeClaims"},
		{resource: "persistentvolumes", errorKey: "persistentVolumes"},
		{resource: "storageclasses", errorKey: "storageClasses"},
		{resource: "events", errorKey: "events"},
	}
	for _, test := range tests {
		t.Run(test.resource, func(t *testing.T) {
			client := minimalDashboardClient()
			client.PrependReactor("list", test.resource, func(clienttesting.Action) (bool, runtime.Object, error) {
				return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: test.resource}, "", errors.New("token=secret-token"))
			})
			snapshot, err := newDashboardService(client, nil).Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"})
			if err != nil {
				t.Fatalf("Dashboard() 不應因 %s 權限不足而失敗：%v", test.resource, err)
			}
			message := snapshot.ResourceErrors[test.errorKey]
			if !strings.Contains(message, "沒有存取權限") || strings.Contains(message, "secret-token") {
				t.Fatalf("%s 降級結果錯誤：errors=%+v", test.resource, snapshot.ResourceErrors)
			}
		})
	}
}

// 泛用 detail 路徑支援任意可解析 GVK（含 networking / storage），並依 scope 決定是否帶 namespace。
// cluster-scoped 資源（PV/StorageClass）的 related Events 以跨 namespace 方式查詢。
func TestResourceDetail泛用支援Networking與Storage(t *testing.T) {
	mapper := meta.NewDefaultRESTMapper(nil)
	mapper.Add(schema.GroupVersionKind{Version: "v1", Kind: "Service"}, meta.RESTScopeNamespace)
	mapper.Add(schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: "Ingress"}, meta.RESTScopeNamespace)
	mapper.Add(schema.GroupVersionKind{Version: "v1", Kind: "PersistentVolumeClaim"}, meta.RESTScopeNamespace)
	mapper.Add(schema.GroupVersionKind{Version: "v1", Kind: "PersistentVolume"}, meta.RESTScopeRoot)
	mapper.Add(schema.GroupVersionKind{Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass"}, meta.RESTScopeRoot)

	listKinds := map[schema.GroupVersionResource]string{
		{Version: "v1", Resource: "services"}:                                "ServiceList",
		{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}:   "IngressList",
		{Version: "v1", Resource: "persistentvolumeclaims"}:                  "PersistentVolumeClaimList",
		{Version: "v1", Resource: "persistentvolumes"}:                       "PersistentVolumeList",
		{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"}: "StorageClassList",
		{Version: "v1", Resource: "events"}:                                  "EventList",
	}
	obj := func(apiVersion, kind, name, namespace string) *unstructured.Unstructured {
		metadata := map[string]interface{}{"name": name}
		if namespace != "" {
			metadata["namespace"] = namespace
		}
		return &unstructured.Unstructured{Object: map[string]interface{}{"apiVersion": apiVersion, "kind": kind, "metadata": metadata}}
	}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), listKinds,
		obj("v1", "Service", "api", "default"),
		obj("networking.k8s.io/v1", "Ingress", "api", "default"),
		obj("v1", "PersistentVolumeClaim", "data", "default"),
		obj("v1", "PersistentVolume", "volume", ""),
		obj("storage.k8s.io/v1", "StorageClass", "standard", ""),
	)
	client := kubernetesfake.NewSimpleClientset()
	svc := &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{core: client, dynamic: dyn, restMapper: mapper},
	}
	tests := []struct {
		kind, apiVersion, name, namespace, wantKind string
	}{
		{kind: "Service", apiVersion: "v1", name: "api", namespace: "default", wantKind: "Service"},
		{kind: "Ingress", apiVersion: "networking.k8s.io/v1", name: "api", namespace: "default", wantKind: "Ingress"},
		{kind: "PersistentVolumeClaim", apiVersion: "v1", name: "data", namespace: "default", wantKind: "PersistentVolumeClaim"},
		{kind: "PersistentVolume", apiVersion: "v1", name: "volume", wantKind: "PersistentVolume"},
		{kind: "StorageClass", apiVersion: "storage.k8s.io/v1", name: "standard", wantKind: "StorageClass"},
	}
	for _, test := range tests {
		t.Run(test.kind, func(t *testing.T) {
			detail, err := svc.ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{Kind: test.kind, APIVersion: test.apiVersion, Name: test.name, Namespace: test.namespace})
			if err != nil {
				t.Fatalf("ResourceDetail() error = %v", err)
			}
			if detail.Kind != test.wantKind || detail.Name != test.name {
				t.Fatalf("ResourceDetail() = %+v", detail)
			}
		})
	}
	var clusterEventLists int
	for _, action := range client.Actions() {
		if action.GetVerb() == "list" && action.GetResource().Resource == "events" && action.GetNamespace() == "" {
			clusterEventLists++
		}
	}
	if clusterEventLists != 2 {
		t.Fatalf("Cluster scope related Events 查詢次數 = %d，want 2", clusterEventLists)
	}
}
