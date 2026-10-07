package kubernetes

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/go-cmp/cmp"
	"github.com/jie0214/TermiX/shared/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

func analysisFixture() (*Service, *kubernetesfake.Clientset, dto.PodAnalysisRequest) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "payments", UID: types.UID("uid-1"), Annotations: map[string]string{"sensitive": "annotation-secret"}},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api", Image: "app:v1", Command: []string{"command-secret"}, Env: []corev1.EnvVar{{Name: "TOKEN", Value: "literal-secret"}}}}},
		Status:     corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{Name: "api", RestartCount: 8, LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", ExitCode: 137}}}}},
	}
	client := kubernetesfake.NewSimpleClientset(pod, &corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: "event", Namespace: "payments"}, InvolvedObject: corev1.ObjectReference{UID: "uid-1"}, Reason: "BackOff"})
	svc := resourceTestService(client)
	svc.activeSession.ConnectedAt = "connection-1"
	return svc, client, dto.PodAnalysisRequest{ConnectedAt: "connection-1", Namespace: "payments", PodName: "api-0", PodUID: "uid-1", Container: "api", IncludeEvents: true, IncludeLogs: true}
}

func TestPodAnalysisSnapshotSanitizesAndCapturesPreviousLogs(t *testing.T) {
	svc, client, request := analysisFixture()
	var previous []bool
	svc.activeClients.podLogs = func(ctx context.Context, ns, pod string, opts *corev1.PodLogOptions) (io.ReadCloser, error) {
		if ns != "payments" || pod != "api-0" || opts.Container != "api" || *opts.TailLines != 200 || *opts.LimitBytes != analysisLogBytes {
			t.Fatal("日誌收集範圍不正確")
		}
		previous = append(previous, opts.Previous)
		return io.NopCloser(strings.NewReader("diagnostic log")), nil
	}
	result, err := svc.PodAnalysisSnapshot(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]bool{false, true}, previous); diff != "" {
		t.Fatal(diff)
	}
	if len(result.Evidence) != 4 {
		t.Fatalf("evidence count = %d", len(result.Evidence))
	}
	for _, forbidden := range []string{"literal-secret", "annotation-secret", "command-secret"} {
		if strings.Contains(result.Evidence[0].Content, forbidden) {
			t.Fatalf("快照包含敏感值 %s", forbidden)
		}
	}
	if !strings.Contains(result.Evidence[0].Content, "OOMKilled") {
		t.Fatal("缺少診斷狀態")
	}
	for _, action := range client.Actions() {
		if action.GetResource().Resource == "secrets" {
			t.Fatal("不得查詢 Secret")
		}
		if action.GetVerb() != "get" && action.GetVerb() != "list" {
			t.Fatal("非唯讀操作")
		}
	}
}

func TestPodAnalysisRejectsStaleConnectionUIDAndContainer(t *testing.T) {
	for _, scenario := range []string{"connection", "uid", "container"} {
		t.Run(scenario, func(t *testing.T) {
			svc, _, request := analysisFixture()
			switch scenario {
			case "connection":
				request.ConnectedAt = "old"
			case "uid":
				request.PodUID = "old"
			case "container":
				request.Container = "other"
			}
			if _, err := svc.PodAnalysisSnapshot(context.Background(), request); err == nil {
				t.Fatal("應拒絕過期或無效的範圍")
			}
		})
	}
}

func TestPodAnalysisRejectsClusterSwitchDuringCollection(t *testing.T) {
	svc, _, request := analysisFixture()
	svc.activeClients.podLogs = func(context.Context, string, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		svc.mu.Lock()
		svc.activeSession.ConnectedAt = "connection-2"
		svc.mu.Unlock()
		return io.NopCloser(strings.NewReader("old cluster")), nil
	}
	if _, err := svc.PodAnalysisSnapshot(context.Background(), request); err == nil {
		t.Fatal("不得分析舊叢集快照")
	}
}

func TestPodAnalysisOptionalSourcesAndRBACWarnings(t *testing.T) {
	svc, client, request := analysisFixture()
	request.IncludeEvents = false
	request.IncludeLogs = false
	result, err := svc.PodAnalysisSnapshot(context.Background(), request)
	if err != nil || len(result.Evidence) != 1 {
		t.Fatalf("%+v %v", result, err)
	}
	for _, action := range client.Actions() {
		if action.GetResource().Resource == "events" {
			t.Fatal("未選取 Events 仍讀取")
		}
	}
	client.PrependReactor("list", "events", func(clienttesting.Action) (bool, runtime.Object, error) { return true, nil, errors.New("forbidden") })
	request.IncludeEvents = true
	result, err = svc.PodAnalysisSnapshot(context.Background(), request)
	if err != nil || len(result.Warnings) != 1 {
		t.Fatalf("應顯示缺少證據的警告：%+v %v", result, err)
	}
}

func TestPodAnalysisLogsBoundedAndValidUTF8(t *testing.T) {
	svc, _, request := analysisFixture()
	svc.activeClients.podLogs = func(context.Context, string, string, *corev1.PodLogOptions) (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader(strings.Repeat("測", analysisLogBytes))), nil
	}
	result, err := svc.PodAnalysisSnapshot(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Evidence[2:] {
		if !item.Truncated || !utf8.ValidString(item.Content) || len(item.Content) > analysisLogBytes+100 {
			t.Fatal("日誌大小或編碼無效")
		}
	}
}
