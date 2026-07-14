package kubernetes

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// Pod 走 typed 路徑：驗證 sanitizedPodYAML、containers/ports、events 排序與長度限制、metadata 轉換。
func TestResourceDetailPodTypedPath(t *testing.T) {
	now := metav1.NewTime(time.Date(2026, 6, 19, 8, 0, 0, 0, time.UTC))
	uid := func(value string) typesUID { return typesUID(value) }
	controller := true
	client := kubernetesfake.NewSimpleClientset(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", UID: uid("pod-a"), CreationTimestamp: now, Labels: map[string]string{"app": "api"}, Annotations: map[string]string{"credential": "secret-token"}, OwnerReferences: []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-abc", UID: uid("owner-a"), Controller: &controller}}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api", Image: "api:v1", Env: []corev1.EnvVar{{Name: "TOKEN", Value: "secret-token"}}, Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 8080, Protocol: corev1.ProtocolTCP}}}}},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{{Name: "api", Ready: true, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}}},
		},
		&corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: "old", Namespace: "default", CreationTimestamp: metav1.NewTime(now.Add(-time.Minute))}, InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: "api-0", Namespace: "default", UID: uid("pod-a")}, Type: corev1.EventTypeNormal, Reason: "Scheduled", Message: "scheduled"},
		&corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: "new", Namespace: "default", CreationTimestamp: now}, InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: "api-0", Namespace: "default", UID: uid("pod-a")}, Type: corev1.EventTypeWarning, Reason: "Failed", Message: strings.Repeat("x", maxKubernetesMessageBytes+10)},
	)
	svc := resourceTestService(client)
	pod, err := svc.ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{Kind: "pod", Name: "api-0", Namespace: "default"})
	if err != nil {
		t.Fatal(err)
	}
	if pod.Kind != "Pod" || pod.Name != "api-0" {
		t.Fatalf("ResourceDetail() = %+v", pod)
	}
	// env 字面值照實呈現（不遮罩）：名稱 TOKEN、值 secret-token、來源為空（非 valueFrom）。
	if len(pod.Containers) != 1 || len(pod.Containers[0].Env) != 1 ||
		pod.Containers[0].Env[0].Name != "TOKEN" || pod.Containers[0].Env[0].Value != "secret-token" || pod.Containers[0].Env[0].Source != "" {
		t.Fatalf("Pod env 摘要不正確：%+v", pod.Containers)
	}
	// events 改由 ResourceEvents 獨立查詢，detail 本身不含 events。
	if len(pod.Events) != 0 {
		t.Fatalf("ResourceDetail 不應內含 events：%+v", pod.Events)
	}
	events, err := svc.ResourceEvents(context.Background(), dto.KubernetesResourceEventsRequest{Kind: "Pod", Name: "api-0", Namespace: "default", UID: "pod-a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(events.Events) != 2 || events.Events[0].Reason != "Failed" || len(events.Events[0].Message) != maxKubernetesMessageBytes {
		t.Fatalf("Events 未正確排序或限制長度：%+v", events.Events)
	}
	if pod.UID != "pod-a" || pod.APIVersion != "v1" || len(pod.Owners) != 1 || !pod.Owners[0].Controller {
		t.Fatalf("Pod Metadata 未完整轉換：%+v", pod)
	}
	if len(pod.Containers) != 1 || len(pod.Containers[0].Ports) != 1 || pod.Containers[0].Ports[0].Port != 8080 {
		t.Fatalf("Pod Container Port 未完整轉換：%+v", pod.Containers)
	}
	// YAML：env 值照實輸出（含 secret-token），但仍移除 annotations / managedFields。
	if !strings.Contains(pod.YAML, "kind: Pod") || !strings.Contains(pod.YAML, "name: api-0") || !strings.Contains(pod.YAML, "secret-token") || strings.Contains(pod.YAML, "annotations:") {
		t.Fatalf("Pod YAML 不正確：%s", pod.YAML)
	}
}

// 非 Pod 的 kind 走泛用 dynamic Get，回傳含 YAML、labels、name/namespace。
func TestResourceDetailGenericNamespaced(t *testing.T) {
	now := metav1.NewTime(time.Date(2026, 6, 19, 8, 0, 0, 0, time.UTC))
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata": map[string]interface{}{
			"name":              "api",
			"namespace":         "default",
			"uid":               "deploy-a",
			"creationTimestamp": now.UTC().Format(time.RFC3339),
			"labels":            map[string]interface{}{"app": "api"},
			"managedFields":     []interface{}{map[string]interface{}{"manager": "kubectl"}},
		},
	}}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), testDynamicListKinds, obj)
	svc := &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{core: kubernetesfake.NewSimpleClientset(), dynamic: dyn, restMapper: newTestRESTMapper()},
	}
	detail, err := svc.ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{Kind: "Deployment", APIVersion: "apps/v1", Name: "api", Namespace: "default"})
	if err != nil {
		t.Fatalf("ResourceDetail() error = %v", err)
	}
	if detail.Kind != "Deployment" || detail.Name != "api" || detail.Namespace != "default" || detail.UID != "deploy-a" {
		t.Fatalf("ResourceDetail() = %+v", detail)
	}
	if len(detail.Labels) != 1 || detail.Labels[0].Key != "app" {
		t.Fatalf("ResourceDetail() labels = %+v", detail.Labels)
	}
	if !strings.Contains(detail.YAML, "kind: Deployment") || !strings.Contains(detail.YAML, "name: api") || strings.Contains(detail.YAML, "managedFields") {
		t.Fatalf("ResourceDetail() YAML 未安全化：%s", detail.YAML)
	}
}

// Secret 的 detail YAML 必須遮蔽 data / stringData 的值，但保留 key 名。
func TestResourceDetailSecretRedactsValues(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata":   map[string]interface{}{"name": "credentials", "namespace": "default"},
		"data":       map[string]interface{}{"token": "c2VjcmV0LXRva2Vu"},
		"stringData": map[string]interface{}{"password": "hunter2"},
	}}
	mapper := meta.NewDefaultRESTMapper(nil)
	mapper.Add(schema.GroupVersionKind{Version: "v1", Kind: "Secret"}, meta.RESTScopeNamespace)
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), testDynamicListKinds, obj)
	svc := &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{core: kubernetesfake.NewSimpleClientset(), dynamic: dyn, restMapper: mapper},
	}
	detail, err := svc.ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{Kind: "Secret", APIVersion: "v1", Name: "credentials", Namespace: "default"})
	if err != nil {
		t.Fatalf("ResourceDetail() error = %v", err)
	}
	if strings.Contains(detail.YAML, "c2VjcmV0LXRva2Vu") || strings.Contains(detail.YAML, "hunter2") {
		t.Fatalf("Secret detail YAML 洩漏值：%s", detail.YAML)
	}
	if !strings.Contains(detail.YAML, "token") || !strings.Contains(detail.YAML, "password") || !strings.Contains(detail.YAML, "***REDACTED***") {
		t.Fatalf("Secret detail YAML 未保留 key 名或未遮蔽：%s", detail.YAML)
	}
}

// GVK 在叢集中無對映時，回傳明確的中文錯誤（找不到指定資源類型走 resourceReadError 分支）。
func TestResourceDetailRejectsUnknownGVK(t *testing.T) {
	_, err := resourceTestService(kubernetesfake.NewSimpleClientset()).ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{Kind: "Widget", APIVersion: "example.com/v1", Name: "w", Namespace: "default"})
	if err == nil {
		t.Fatalf("ResourceDetail() 應對未知 GVK 回錯")
	}
}

func TestResourceDetailCorrectsStalePodNamespaceWhenMatchIsUnique(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "production", UID: typesUID("pod-a")},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api"}}},
	})
	detail, err := resourceTestService(client).ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{
		Kind: "pod", Name: "api-0", Namespace: "stale-namespace",
	})
	if err != nil {
		t.Fatalf("ResourceDetail() error = %v", err)
	}
	if detail.Namespace != "production" || detail.Name != "api-0" {
		t.Fatalf("ResourceDetail() 未校正 Namespace：%+v", detail)
	}
}

func TestResourceDetailDoesNotGuessAmbiguousPodNamespace(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "alpha"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "beta"}},
	)
	_, err := resourceTestService(client).ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{
		Kind: "pod", Name: "api-0", Namespace: "stale-namespace",
	})
	if err == nil || !strings.Contains(err.Error(), "找不到指定資源") {
		t.Fatalf("ResourceDetail() 應拒絕模糊匹配，error = %v", err)
	}
}

func TestResourceDetailMasksRBACErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"forbidden", apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "api", errors.New("secret-token")), "沒有存取權限"},
		{"unauthorized", apierrors.NewUnauthorized("secret-token"), "認證已失效"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := kubernetesfake.NewSimpleClientset()
			client.PrependReactor("get", "pods", func(clienttesting.Action) (bool, runtime.Object, error) { return true, nil, test.err })
			_, err := resourceTestService(client).ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{Kind: "pod", Name: "api", Namespace: "default"})
			if err == nil || !strings.Contains(err.Error(), test.want) || strings.Contains(err.Error(), "secret-token") {
				t.Fatalf("ResourceDetail() error = %v", err)
			}
		})
	}
}

func TestResourceEventsDegradesWhenEventsAreForbidden(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", UID: typesUID("pod-a")},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api", Image: "api:v1"}}},
	})
	client.PrependReactor("list", "events", func(action clienttesting.Action) (bool, runtime.Object, error) {
		selector := action.(clienttesting.ListAction).GetListRestrictions().Fields.String()
		if selector != "involvedObject.uid=pod-a" {
			t.Fatalf("Events FieldSelector = %q", selector)
		}
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "events"}, "", errors.New("token=secret-token"))
	})

	// events 已從 detail 拆出：改由 ResourceEvents 查詢，失敗時安全降級（EventsError，不外洩底層訊息）。
	events, err := resourceTestService(client).ResourceEvents(context.Background(), dto.KubernetesResourceEventsRequest{Kind: "pod", Name: "api", Namespace: "default", UID: "pod-a"})
	if err != nil {
		t.Fatalf("ResourceEvents() error = %v", err)
	}
	if !strings.Contains(events.EventsError, "沒有存取權限") || strings.Contains(events.EventsError, "secret-token") {
		t.Fatalf("ResourceEvents() 未安全降級：%+v", events)
	}
}

func TestPodLogsValidatesOptionsAndTruncates(t *testing.T) {
	svc := resourceTestService(kubernetesfake.NewSimpleClientset())
	var received *corev1.PodLogOptions
	svc.activeClients.podLogs = func(_ context.Context, namespace, pod string, options *corev1.PodLogOptions) (io.ReadCloser, error) {
		if namespace != "default" || pod != "api-0" {
			t.Fatalf("PodLogs() target = %s/%s", namespace, pod)
		}
		received = options
		return io.NopCloser(strings.NewReader(strings.Repeat("x", maxPodLogBytes+10))), nil
	}
	result, err := svc.PodLogs(context.Background(), dto.KubernetesPodLogsRequest{Namespace: "default", PodName: "api-0", Container: "api", Previous: true})
	if err != nil {
		t.Fatalf("PodLogs() error = %v", err)
	}
	if !result.Truncated || len(result.Content) != maxPodLogBytes || received == nil || received.TailLines == nil || *received.TailLines != 200 || !received.Previous {
		t.Fatalf("PodLogs() = %+v options=%+v", result, received)
	}
	_, err = svc.PodLogs(context.Background(), dto.KubernetesPodLogsRequest{Namespace: "default", PodName: "api-0", Container: "api", TailLines: 1001})
	if err == nil || !strings.Contains(err.Error(), "1 至 1000") {
		t.Fatalf("PodLogs() tailLines error = %v", err)
	}
}

func TestPodLogsMasksCredentialErrors(t *testing.T) {
	svc := resourceTestService(kubernetesfake.NewSimpleClientset())
	svc.activeClients.podLogs = func(context.Context, string, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return nil, errors.New("exec plugin token=secret-token")
	}
	_, err := svc.PodLogs(context.Background(), dto.KubernetesPodLogsRequest{Namespace: "default", PodName: "api-0", Container: "api"})
	if err == nil || !strings.Contains(err.Error(), "請檢查網路") || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("PodLogs() error = %v", err)
	}
}

func TestLimitedTextPreservesUTF8(t *testing.T) {
	result := limitedText(strings.Repeat("測", maxKubernetesMessageBytes))
	if len(result) > maxKubernetesMessageBytes || !utf8.ValidString(result) {
		t.Fatalf("limitedText() 未維持有效 UTF-8：長度=%d", len(result))
	}
}

func resourceTestService(client *kubernetesfake.Clientset) *Service {
	return &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{core: client, dynamic: newTestDynamicClient(), restMapper: newTestRESTMapper()},
	}
}

// typesUID 保持測試資料宣告精簡，底層型別與 Kubernetes UID 相容。
type typesUID = types.UID
