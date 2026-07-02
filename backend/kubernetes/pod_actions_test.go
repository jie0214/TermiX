package kubernetes

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

func TestDeletePodUsesUIDPrecondition(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", UID: types.UID("pod-a")}})
	client.PrependReactor("delete", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		deleteAction := action.(clienttesting.DeleteAction)
		options := deleteAction.GetDeleteOptions()
		if options.Preconditions == nil || options.Preconditions.UID == nil || *options.Preconditions.UID != types.UID("pod-a") {
			t.Fatalf("DeleteOptions 未使用 Pod UID：%+v", options)
		}
		return false, nil, nil
	})
	service := resourceTestService(client)
	if err := service.DeletePod(context.Background(), dto.KubernetesPodDeleteRequest{Namespace: "default", PodName: "api-0", UID: "pod-a"}); err != nil {
		t.Fatalf("DeletePod() error = %v", err)
	}
}

// 非 Pod 的 namespaced 資源走泛用 dynamic Delete，並帶入 UID precondition。
func TestDeleteResourceDeletesNamespacedViaDynamic(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1", "kind": "Deployment",
		"metadata": map[string]interface{}{"name": "api", "namespace": "default", "uid": "deploy-a"},
	}}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), testDynamicListKinds, obj)
	svc := deleteTestService(dyn)
	err := svc.DeleteResource(context.Background(), dto.KubernetesResourceDeleteRequest{
		Kind: "Deployment", APIVersion: "apps/v1", Namespace: "default", Name: "api", UID: "deploy-a",
	})
	if err != nil {
		t.Fatalf("DeleteResource() error = %v", err)
	}
	actions := dyn.Actions()
	if len(actions) != 1 || actions[0].GetVerb() != "delete" ||
		actions[0].GetResource() != (schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}) ||
		actions[0].GetNamespace() != "default" {
		t.Fatalf("Delete action = %+v", actions)
	}
}

// cluster-scoped 資源走泛用 dynamic Delete，且不帶 namespace。
func TestDeleteResourceDeletesClusterScopedViaDynamic(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "example.com/v1", "kind": "ClusterWidget",
		"metadata": map[string]interface{}{"name": "widget"},
	}}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), testDynamicListKinds, obj)
	svc := deleteTestService(dyn)
	err := svc.DeleteResource(context.Background(), dto.KubernetesResourceDeleteRequest{
		Kind: "ClusterWidget", APIVersion: "example.com/v1", Name: "widget",
	})
	if err != nil {
		t.Fatalf("DeleteResource() error = %v", err)
	}
	actions := dyn.Actions()
	if len(actions) != 1 || actions[0].GetVerb() != "delete" || actions[0].GetNamespace() != "" {
		t.Fatalf("Delete action = %+v", actions)
	}
}

func TestDeleteResourceRejectsUnknownGVK(t *testing.T) {
	dyn := newTestDynamicClient()
	err := deleteTestService(dyn).DeleteResource(context.Background(), dto.KubernetesResourceDeleteRequest{
		Kind: "Widget", APIVersion: "unknown.io/v1", Namespace: "default", Name: "credentials",
	})
	if err == nil || !strings.Contains(err.Error(), "找不到此資源類型") {
		t.Fatalf("DeleteResource() error = %v", err)
	}
}

func deleteTestService(dyn *dynamicfake.FakeDynamicClient) *Service {
	return &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{core: kubernetesfake.NewSimpleClientset(), dynamic: dyn, restMapper: newTestRESTMapper()},
	}
}

func TestDeletePodMasksRBACError(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset()
	client.PrependReactor("delete", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "api-0", errors.New("token=secret-token"))
	})
	err := resourceTestService(client).DeletePod(context.Background(), dto.KubernetesPodDeleteRequest{Namespace: "default", PodName: "api-0"})
	if err == nil || !strings.Contains(err.Error(), "沒有存取權限") || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("DeletePod() error = %v", err)
	}
}

func TestPodPortForwardLifecycle(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"}})
	service := resourceTestService(client)
	service.portForwards = make(map[string]*podPortForwardEntry)
	stopped := false
	done := make(chan error, 1)
	service.forwardStarter = func(_ *clusterClients, namespace, podName string, localPort, remotePort int) (*podPortForwardRuntime, error) {
		if namespace != "default" || podName != "api-0" || localPort != 0 || remotePort != 8080 {
			t.Fatalf("Port Forward 參數錯誤：%s/%s %d:%d", namespace, podName, localPort, remotePort)
		}
		return &podPortForwardRuntime{localPort: 19090, stop: func() { stopped = true }, done: done}, nil
	}
	forward, err := service.StartPodPortForward(context.Background(), dto.KubernetesPodPortForwardRequest{Namespace: "default", PodName: "api-0", LocalPort: 0, RemotePort: 8080})
	if err != nil {
		t.Fatalf("StartPodPortForward() error = %v", err)
	}
	if forward.Address != "127.0.0.1" || forward.LocalPort != 19090 || len(service.ListPodPortForwards(dto.KubernetesPodPortForwardListRequest{PodName: "api-0"})) != 1 {
		t.Fatalf("StartPodPortForward() = %+v", forward)
	}
	if err := service.StopPodPortForward(forward.ID); err != nil {
		t.Fatalf("StopPodPortForward() error = %v", err)
	}
	if !stopped || len(service.ListPodPortForwards(dto.KubernetesPodPortForwardListRequest{})) != 0 {
		t.Fatalf("Port Forward 未停止：stopped=%v", stopped)
	}
}

func TestPodPortForwardValidatesPortsAndMasksStarterError(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"}})
	service := resourceTestService(client)
	_, err := service.StartPodPortForward(context.Background(), dto.KubernetesPodPortForwardRequest{Namespace: "default", PodName: "api-0", LocalPort: -1, RemotePort: 8080})
	if err == nil || !strings.Contains(err.Error(), "連接埠") {
		t.Fatalf("StartPodPortForward() validation error = %v", err)
	}
	service.forwardStarter = func(*clusterClients, string, string, int, int) (*podPortForwardRuntime, error) {
		return nil, errors.New("Authorization: Bearer secret-token")
	}
	_, err = service.StartPodPortForward(context.Background(), dto.KubernetesPodPortForwardRequest{Namespace: "default", PodName: "api-0", LocalPort: 0, RemotePort: 8080})
	if err == nil || strings.Contains(err.Error(), "secret-token") || !strings.Contains(err.Error(), "pods/portforward") {
		t.Fatalf("StartPodPortForward() safe error = %v", err)
	}
}
