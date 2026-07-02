package kubernetes

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func Test假KubernetesAPIServer資源詳情與PodLogs(t *testing.T) {
	const podUID = "pod-api-uid"
	var receivedEventSelector string
	var receivedLogQuery url.Values
	transport := http處理器Transport(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/namespaces/default/pods/api":
			writeKubernetesJSON(t, writer, corev1.Pod{
				TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "Pod"},
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", UID: podUID},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api", Image: "api:v1"}}},
				Status:     corev1.PodStatus{Phase: corev1.PodRunning},
			})
		case "/api/v1/namespaces/default/events":
			receivedEventSelector = request.URL.Query().Get("fieldSelector")
			writeKubernetesJSON(t, writer, corev1.EventList{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "EventList"},
				Items: []corev1.Event{{
					ObjectMeta:     metav1.ObjectMeta{Name: "scheduled", Namespace: "default"},
					InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: "api", Namespace: "default", UID: podUID},
					Type:           corev1.EventTypeNormal, Reason: "Scheduled", Message: "已排程",
				}},
			})
		case "/api/v1/namespaces/default/pods/api/log":
			receivedLogQuery = request.URL.Query()
			writer.Header().Set("Content-Type", "text/plain")
			_, _ = io.WriteString(writer, "第一行\n第二行\n")
		default:
			http.NotFound(writer, request)
		}
	}))

	service := http測試服務(t, transport)
	detail, err := service.ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{
		Kind: "pod", Name: "api", Namespace: "default",
	})
	if err != nil {
		t.Fatalf("ResourceDetail() error = %v", err)
	}
	if detail.Name != "api" || len(detail.Events) != 1 || detail.Events[0].Reason != "Scheduled" {
		t.Fatalf("ResourceDetail() = %+v", detail)
	}
	if receivedEventSelector != "involvedObject.uid="+podUID {
		t.Fatalf("Events fieldSelector = %q", receivedEventSelector)
	}

	logs, err := service.PodLogs(context.Background(), dto.KubernetesPodLogsRequest{
		Namespace: "default", PodName: "api", Container: "api", Previous: true, TailLines: 25,
	})
	if err != nil {
		t.Fatalf("PodLogs() error = %v", err)
	}
	if logs.Content != "第一行\n第二行\n" || logs.Container != "api" || logs.Truncated {
		t.Fatalf("PodLogs() = %+v", logs)
	}
	if receivedLogQuery.Get("container") != "api" || receivedLogQuery.Get("previous") != "true" || receivedLogQuery.Get("tailLines") != "25" {
		t.Fatalf("Pod Logs query = %v", receivedLogQuery)
	}
}

func Test假KubernetesAPIServer遮罩權限與認證錯誤(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		want       string
	}{
		{name: "權限不足", statusCode: http.StatusForbidden, want: "沒有存取權限"},
		{name: "認證過期", statusCode: http.StatusUnauthorized, want: "認證已失效"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			reason := "Forbidden"
			if test.statusCode == http.StatusUnauthorized {
				reason = "Unauthorized"
			}
			transport := http處理器Transport(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				writer.WriteHeader(test.statusCode)
				_ = json.NewEncoder(writer).Encode(map[string]any{
					"kind": "Status", "apiVersion": "v1", "status": "Failure",
					"message": "token=secret-token", "reason": reason, "code": test.statusCode,
				})
			}))

			_, err := http測試服務(t, transport).ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{
				Kind: "pod", Name: "api", Namespace: "default",
			})
			if err == nil || !strings.Contains(err.Error(), test.want) || strings.Contains(err.Error(), "secret-token") {
				t.Fatalf("ResourceDetail() error = %v", err)
			}
		})
	}
}

func Test假KubernetesAPIServerPodLogs遮罩權限與認證錯誤(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		reason     string
		want       string
	}{
		{name: "權限不足", statusCode: http.StatusForbidden, reason: "Forbidden", want: "沒有存取權限"},
		{name: "認證過期", statusCode: http.StatusUnauthorized, reason: "Unauthorized", want: "認證已失效"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transport := http處理器Transport(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				writer.WriteHeader(test.statusCode)
				_ = json.NewEncoder(writer).Encode(map[string]any{
					"kind": "Status", "apiVersion": "v1", "status": "Failure",
					"message": "token=secret-token", "reason": test.reason, "code": test.statusCode,
				})
			}))
			_, err := http測試服務(t, transport).PodLogs(context.Background(), dto.KubernetesPodLogsRequest{
				Namespace: "default", PodName: "api", Container: "api",
			})
			if err == nil || !strings.Contains(err.Error(), test.want) || strings.Contains(err.Error(), "secret-token") {
				t.Fatalf("PodLogs() error = %v", err)
			}
		})
	}
}

func Test假KubernetesAPIServer網路中斷不洩漏底層錯誤(t *testing.T) {
	service := http測試服務(t, roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, io.ErrUnexpectedEOF
	}))

	_, err := service.ResourceDetail(context.Background(), dto.KubernetesResourceDetailRequest{
		Kind: "pod", Name: "api", Namespace: "default",
	})
	if err == nil || !strings.Contains(err.Error(), "請檢查網路") || strings.Contains(err.Error(), "unexpected EOF") {
		t.Fatalf("ResourceDetail() error = %v", err)
	}
}

func Test假MetricsAPI缺失時安全降級(t *testing.T) {
	transport := http處理器Transport(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(writer, `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"the server could not find the requested resource","reason":"NotFound","code":404}`)
	}))

	config := &rest.Config{Host: "https://kubernetes.test", Transport: transport}
	metrics, err := metricsclient.NewForConfig(config)
	if err != nil {
		t.Fatalf("建立 Metrics Client 失敗：%v", err)
	}
	snapshot := dto.KubernetesDashboardSnapshot{}
	loadMetrics(context.Background(), &clusterClients{metrics: metrics}, "default", &snapshot)
	if snapshot.Metrics.Available || snapshot.Metrics.Error != "叢集未提供 Metrics API" {
		t.Fatalf("Metrics 降級結果 = %+v", snapshot.Metrics)
	}
}

func http測試服務(t *testing.T, transport http.RoundTripper) *Service {
	t.Helper()
	config := &rest.Config{Host: "https://kubernetes.test", Transport: transport}
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		t.Fatalf("建立 Kubernetes Client 失敗：%v", err)
	}
	return &Service{
		activeSession: &dto.KubernetesSession{SessionID: "kubernetes-tab", Namespace: "default"},
		activeClients: &clusterClients{
			core: client,
			podLogs: func(ctx context.Context, namespace, podName string, options *corev1.PodLogOptions) (io.ReadCloser, error) {
				return client.CoreV1().Pods(namespace).GetLogs(podName, options).Stream(ctx)
			},
		},
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (function roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func http處理器Transport(handler http.Handler) http.RoundTripper {
	return roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		response := recorder.Result()
		response.Request = request
		return response, nil
	})
}

func writeKubernetesJSON(t *testing.T, writer http.ResponseWriter, value any) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		t.Fatalf("寫入假 Kubernetes API 回應失敗：%v", err)
	}
}
