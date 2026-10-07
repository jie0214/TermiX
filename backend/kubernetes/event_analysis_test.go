package kubernetes

import (
	"context"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/shared/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

func eventAnalysisFixture(t *testing.T) (*Service, dto.EventAnalysisRequest) {
	t.Helper()
	svc, client, _ := analysisFixture()
	_, err := client.CoreV1().Events("payments").Create(context.Background(), &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: "backoff", Namespace: "payments", UID: "event-1"},
		Type:       "Warning", Reason: "BackOff", Message: "Restarting container", Count: 4,
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Name: "api-0", Namespace: "payments", UID: "uid-1"},
	}, metav1.CreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	client.ClearActions()
	return svc, dto.EventAnalysisRequest{ConnectedAt: "connection-1", Namespace: "payments", EventName: "backoff", EventUID: "event-1"}
}

func TestEventAnalysisCollectsSafeEvidence(t *testing.T) {
	svc, request := eventAnalysisFixture(t)
	result, err := svc.EventAnalysisSnapshot(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.EventUID != "event-1" || result.EventName != "backoff" || len(result.Evidence) != 2 {
		t.Fatalf("快照錯誤：%+v", result)
	}
	if !strings.Contains(result.Evidence[0].Content, "BackOff") || !strings.Contains(result.Evidence[1].Content, "OOMKilled") {
		t.Fatal("缺少事件或 Pod 狀態")
	}
	for _, item := range result.Evidence {
		for _, forbidden := range []string{"literal-secret", "command-secret", "annotation-secret"} {
			if strings.Contains(item.Content, forbidden) {
				t.Fatalf("證據包含敏感值：%s", forbidden)
			}
		}
	}
}

func TestEventAnalysisRejectsStaleIdentity(t *testing.T) {
	for _, which := range []string{"connection", "uid"} {
		t.Run(which, func(t *testing.T) {
			svc, request := eventAnalysisFixture(t)
			if which == "connection" {
				request.ConnectedAt = "old"
			}
			if which == "uid" {
				request.EventUID = "old"
			}
			_, err := svc.EventAnalysisSnapshot(context.Background(), request)
			if err == nil {
				t.Fatal("應拒絕過期目標")
			}
		})
	}
}

func TestEventAnalysisMissingOrReplacedRelatedResource(t *testing.T) {
	for _, kind := range []string{"missing", "replaced", "secret"} {
		t.Run(kind, func(t *testing.T) {
			svc, request := eventAnalysisFixture(t)
			client := svc.activeClients.core.(*kubernetesfake.Clientset)
			ev, _ := client.CoreV1().Events("payments").Get(context.Background(), "backoff", metav1.GetOptions{})
			switch kind {
			case "missing":
				ev.InvolvedObject.Name = "deleted"
			case "replaced":
				ev.InvolvedObject.UID = "old-pod"
			case "secret":
				ev.InvolvedObject.Kind = "Secret"
			}
			_, _ = client.CoreV1().Events("payments").Update(context.Background(), ev, metav1.UpdateOptions{})
			client.ClearActions()
			result, err := svc.EventAnalysisSnapshot(context.Background(), request)
			if err != nil || len(result.Evidence) != 1 || len(result.Warnings) != 1 {
				t.Fatalf("應以事件降級分析：%+v %v", result, err)
			}
			for _, action := range client.Actions() {
				if action.GetVerb() != "get" || action.GetResource().Resource == "secrets" || action.GetSubresource() == "log" {
					t.Fatalf("不應執行：%+v", action)
				}
			}
		})
	}
}

func TestEventAnalysisStopsAfterClusterChanges(t *testing.T) {
	svc, request := eventAnalysisFixture(t)
	client := svc.activeClients.core.(*kubernetesfake.Clientset)
	client.PrependReactor("get", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		svc.activeSession.ConnectedAt = "connection-2"
		return false, nil, nil
	})
	if _, err := svc.EventAnalysisSnapshot(context.Background(), request); err == nil {
		t.Fatal("應停止跨叢集分析")
	}
}

func TestEventAnalysisRejectsEventReplacedDuringRead(t *testing.T) {
	svc, request := eventAnalysisFixture(t)
	client := svc.activeClients.core.(*kubernetesfake.Clientset)
	reads := 0
	client.PrependReactor("get", "events", func(clienttesting.Action) (bool, runtime.Object, error) {
		reads++
		if reads == 2 {
			return true, &corev1.Event{ObjectMeta: metav1.ObjectMeta{UID: "replacement"}}, nil
		}
		return false, nil, nil
	})
	if _, err := svc.EventAnalysisSnapshot(context.Background(), request); err == nil {
		t.Fatal("應停止分析被替換的 Event")
	}
}
