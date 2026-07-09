package kubernetes

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jie0214/TermiX/shared/dto"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"
)

func TestDashboardBuildsVerifiedSnapshot(t *testing.T) {
	now := metav1.NewTime(time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC))
	replicas := int32(2)
	coreClient := kubernetesfake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "monitoring"}},
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a", CreationTimestamp: now, Labels: map[string]string{"node-role.kubernetes.io/worker": ""}},
			Status: corev1.NodeStatus{
				Capacity:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("4"), corev1.ResourceMemory: resource.MustParse("8Gi")},
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
				NodeInfo:   corev1.NodeSystemInfo{KubeletVersion: "v1.35.0"},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", CreationTimestamp: now},
			Spec:       corev1.PodSpec{NodeName: "node-a", Containers: []corev1.Container{{Name: "api"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{{Name: "api", Ready: true, RestartCount: 1}}},
		},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", CreationTimestamp: now},
			Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
			Status:     appsv1.DeploymentStatus{ReadyReplicas: 2, AvailableReplicas: 2},
		},
		&appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default", CreationTimestamp: now},
			Spec:       appsv1.StatefulSetSpec{Replicas: &replicas},
			Status:     appsv1.StatefulSetStatus{ReadyReplicas: 1, AvailableReplicas: 1},
		},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"}},
		&corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: "warning", Namespace: "default"}, Type: corev1.EventTypeWarning},
	)
	nodeMetric := metricsv1beta1.NodeMetrics{
		TypeMeta:   metav1.TypeMeta{APIVersion: "metrics.k8s.io/v1beta1", Kind: "NodeMetrics"},
		ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
		Usage:      corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("1000m"), corev1.ResourceMemory: resource.MustParse("2Gi")},
	}
	podMetric := metricsv1beta1.PodMetrics{
		TypeMeta:   metav1.TypeMeta{APIVersion: "metrics.k8s.io/v1beta1", Kind: "PodMetrics"},
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
		Containers: []metricsv1beta1.ContainerMetrics{{Name: "api", Usage: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("250m"), corev1.ResourceMemory: resource.MustParse("256Mi")}}},
	}
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, &metricsv1beta1.NodeMetricsList{Items: []metricsv1beta1.NodeMetrics{nodeMetric}}, nil
	})
	metricsClient.PrependReactor("list", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, &metricsv1beta1.PodMetricsList{Items: []metricsv1beta1.PodMetrics{podMetric}}, nil
	})
	svc := newDashboardService(coreClient, metricsClient)

	snapshot, err := svc.Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"})
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	if snapshot.ServerVersion != "v1.35.0" || len(snapshot.Namespaces) != 2 {
		t.Fatalf("Dashboard() 基本資訊錯誤：%+v", snapshot)
	}
	if snapshot.Overview.Nodes != 1 || snapshot.Overview.ReadyNodes != 1 || snapshot.Overview.RunningPods != 1 {
		t.Fatalf("Dashboard() Overview 錯誤：%+v", snapshot.Overview)
	}
	if snapshot.Overview.ReadyDeployments != 1 || snapshot.Overview.ReadyStatefulSets != 0 || snapshot.Overview.Services != 1 || snapshot.Overview.WarningEvents != 1 {
		t.Fatalf("Dashboard() Workload 統計錯誤：%+v", snapshot.Overview)
	}
	if !snapshot.Metrics.Available || snapshot.Metrics.CPUUsageMilli != 1000 || snapshot.Pods[0].CPUUsageMilli != 250 {
		t.Fatalf("Dashboard() Metrics 錯誤：%+v pod=%+v", snapshot.Metrics, snapshot.Pods[0])
	}
	if len(snapshot.Events) != 1 || snapshot.Events[0].Type != corev1.EventTypeWarning {
		t.Fatalf("Dashboard() Events 錯誤：%+v", snapshot.Events)
	}
}

func TestDashboardDegradesWhenMetricsAPIIsUnavailable(t *testing.T) {
	coreClient := minimalDashboardClient()
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewNotFound(schema.GroupResource{Group: "metrics.k8s.io", Resource: "nodes"}, "")
	})
	svc := newDashboardService(coreClient, metricsClient)

	snapshot, err := svc.Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"})
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	if snapshot.Metrics.Available || snapshot.Metrics.Error != "叢集未提供 Metrics API" {
		t.Fatalf("Metrics 降級錯誤：%+v", snapshot.Metrics)
	}
}

func TestPodSummaryUsesContainerReasonAndIncludesActionsMetadata(t *testing.T) {
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "apps", UID: typesUID("pod-web")},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 8080}}}}},
		Status: corev1.PodStatus{Phase: corev1.PodPending, ContainerStatuses: []corev1.ContainerStatus{{
			Name: "web", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ImagePullBackOff"}},
		}}},
	}
	summary := podSummary(pod)
	if summary.Status != "ImagePullBackOff" || summary.Phase != "Pending" || summary.UID != "pod-web" {
		t.Fatalf("Pod 狀態摘要錯誤：%+v", summary)
	}
	if len(summary.Containers) != 1 || len(summary.Containers[0].Ports) != 1 || summary.Containers[0].Ports[0].Port != 8080 {
		t.Fatalf("Pod Action 中繼資料錯誤：%+v", summary.Containers)
	}
}

func TestDashboardDegradesWhenMetricsAPIIsForbidden(t *testing.T) {
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "metrics.k8s.io", Resource: "nodes"}, "", nil)
	})
	snapshot, err := newDashboardService(minimalDashboardClient(), metricsClient).Dashboard(
		context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"},
	)
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	if snapshot.Metrics.Available || snapshot.Metrics.Error != "Metrics API 權限不足" {
		t.Fatalf("Metrics Forbidden 應降級：%+v", snapshot.Metrics)
	}
}

func TestDashboardAllNamespaces(t *testing.T) {
	coreClient := kubernetesfake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "beta"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "beta"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "alpha"}},
		&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "deployment-b", Namespace: "beta"}},
		&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "statefulset-a", Namespace: "alpha"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "service-b", Namespace: "beta"}},
		&corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: "warning-a", Namespace: "alpha"}, Type: corev1.EventTypeWarning},
	)
	snapshot, err := newDashboardService(coreClient, nil).Dashboard(
		context.Background(), dto.KubernetesDashboardRequest{Namespace: "*"},
	)
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	if snapshot.Namespace != "*" || len(snapshot.Pods) != 2 || snapshot.Overview.Services != 1 || snapshot.Overview.WarningEvents != 1 {
		t.Fatalf("全 Namespace 統計錯誤：%+v", snapshot)
	}
	if snapshot.Pods[0].Namespace != "alpha" || snapshot.Pods[1].Namespace != "beta" {
		t.Fatalf("Pods 排序錯誤：%+v", snapshot.Pods)
	}
}

func TestDashboardReportsRBACForbidden(t *testing.T) {
	coreClient := minimalDashboardClient()
	coreClient.PrependReactor("list", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "", nil)
	})
	svc := newDashboardService(coreClient, metricsfake.NewSimpleClientset())

	_, err := svc.Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"})
	if err == nil || !strings.Contains(err.Error(), "沒有存取權限") {
		t.Fatalf("Dashboard() error = %v", err)
	}
}

func TestDashboardDegradesWhenNodesForbidden(t *testing.T) {
	coreClient := kubernetesfake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "gamemath"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"}},
	)
	coreClient.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "", nil)
	})

	snapshot, err := newDashboardService(coreClient, metricsfake.NewSimpleClientset()).Dashboard(
		context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"},
	)
	if err != nil {
		t.Fatalf("Dashboard() 不應因 Nodes 權限不足而失敗：%v", err)
	}
	if len(snapshot.Namespaces) != 2 || snapshot.Namespaces[0] != "default" || snapshot.Namespaces[1] != "gamemath" {
		t.Fatalf("Dashboard() 應保留可讀 Namespace：%+v", snapshot.Namespaces)
	}
	if len(snapshot.Nodes) != 0 || snapshot.Overview.Nodes != 0 {
		t.Fatalf("Nodes 權限不足時不應產生節點摘要：nodes=%+v overview=%+v", snapshot.Nodes, snapshot.Overview)
	}
	message := snapshot.ResourceErrors["nodes"]
	if !strings.Contains(message, "沒有存取權限") {
		t.Fatalf("Dashboard() 應回報 nodes 降級錯誤：%+v", snapshot.ResourceErrors)
	}
}

func TestDashboardReportsUnauthorizedWithoutLeakingDetails(t *testing.T) {
	coreClient := minimalDashboardClient()
	coreClient.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewUnauthorized("secret-token")
	})
	_, err := newDashboardService(coreClient, metricsfake.NewSimpleClientset()).Dashboard(
		context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"},
	)
	if err == nil || !strings.Contains(err.Error(), "認證已失效") || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("Dashboard() error = %v", err)
	}
}

func TestDashboardDoesNotExposeCredentialPluginOutput(t *testing.T) {
	coreClient := minimalDashboardClient()
	coreClient.PrependReactor("list", "services", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("exec plugin printed secret-token")
	})
	snapshot, err := newDashboardService(coreClient, metricsfake.NewSimpleClientset()).Dashboard(
		context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"},
	)
	if err != nil {
		t.Fatalf("Dashboard() error = %v", err)
	}
	message := snapshot.ResourceErrors["services"]
	if !strings.Contains(message, "請檢查網路") || strings.Contains(message, "secret-token") {
		t.Fatalf("Dashboard() resourceErrors = %+v", snapshot.ResourceErrors)
	}
}

func minimalDashboardClient() *kubernetesfake.Clientset {
	return kubernetesfake.NewSimpleClientset(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}})
}

// scope=core 只抓 Overview 所需核心資源（快速首屏），且標記 Partial=true；非核心資源（如 ConfigMap）不抓。
func TestDashboardCoreScopeSkipsNonCoreResources(t *testing.T) {
	coreClient := kubernetesfake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning},
		},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"}},
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "cfg", Namespace: "default"}},
	)
	svc := newDashboardService(coreClient, metricsfake.NewSimpleClientset())

	coreSnap, err := svc.Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default", Scope: "core"})
	if err != nil {
		t.Fatalf("Dashboard(core) error = %v", err)
	}
	if !coreSnap.Partial {
		t.Fatalf("core scope 應標記 Partial=true：%+v", coreSnap.Partial)
	}
	if len(coreSnap.Pods) != 1 || coreSnap.Overview.Services != 1 {
		t.Fatalf("core scope 應含核心資源：pods=%d services=%d", len(coreSnap.Pods), coreSnap.Overview.Services)
	}
	if len(coreSnap.ConfigMaps) != 0 {
		t.Fatalf("core scope 不應抓非核心資源 ConfigMaps：%+v", coreSnap.ConfigMaps)
	}

	fullSnap, err := svc.Dashboard(context.Background(), dto.KubernetesDashboardRequest{Namespace: "default"})
	if err != nil {
		t.Fatalf("Dashboard(full) error = %v", err)
	}
	if fullSnap.Partial {
		t.Fatalf("full scope 不應標記 Partial")
	}
	if len(fullSnap.ConfigMaps) != 1 {
		t.Fatalf("full scope 應含 ConfigMaps：%+v", fullSnap.ConfigMaps)
	}
}

func newDashboardService(coreClient *kubernetesfake.Clientset, metricsClient *metricsfake.Clientset) *Service {
	session := &dto.KubernetesSession{SessionID: "kubernetes-tab", ClusterName: "test", ContextName: "test"}
	clients := &clusterClients{core: coreClient, serverVersion: "v1.35.0"}
	if metricsClient != nil {
		clients.metrics = metricsClient
	}
	return &Service{
		activeSession: session,
		activeClients: clients,
	}
}

func TestSummaryShowsTerminatingWhenDeletionTimestampSet(t *testing.T) {
	deletionTime := metav1.NewTime(time.Now())

	// Test Node
	node := corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-node",
			DeletionTimestamp: &deletionTime,
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
		},
	}
	nodeSum := nodeSummary(node)
	if nodeSum.Status != "Terminating" {
		t.Errorf("Expected Node status to be Terminating, got %s", nodeSum.Status)
	}

	// Test Deployment
	replicas := int32(1)
	deploy := appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-deploy",
			DeletionTimestamp: &deletionTime,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas: 1,
		},
	}
	deploySum := deploymentSummary(deploy)
	if deploySum.Status != "Terminating" {
		t.Errorf("Expected Deployment status to be Terminating, got %s", deploySum.Status)
	}

	// Test StatefulSet
	sts := appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-sts",
			DeletionTimestamp: &deletionTime,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas: &replicas,
		},
		Status: appsv1.StatefulSetStatus{
			ReadyReplicas: 1,
		},
	}
	stsSum := statefulSetSummary(sts)
	if stsSum.Status != "Terminating" {
		t.Errorf("Expected StatefulSet status to be Terminating, got %s", stsSum.Status)
	}

	// Test PVC
	pvc := corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-pvc",
			DeletionTimestamp: &deletionTime,
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
		},
	}
	pvcSum := persistentVolumeClaimSummary(pvc)
	if pvcSum.Status != "Terminating" {
		t.Errorf("Expected PVC status to be Terminating, got %s", pvcSum.Status)
	}

	// Test PV
	pv := corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-pv",
			DeletionTimestamp: &deletionTime,
		},
		Status: corev1.PersistentVolumeStatus{
			Phase: corev1.VolumeBound,
		},
	}
	pvSum := persistentVolumeSummary(pv)
	if pvSum.Status != "Terminating" {
		t.Errorf("Expected PV status to be Terminating, got %s", pvSum.Status)
	}
}
