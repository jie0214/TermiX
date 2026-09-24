package mobilekubernetes

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"testing"
)

func TestPodMetricsUnitsAndContainerTotals(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/apis/metrics.k8s.io/v1beta1/namespaces/dev/pods/web" || r.Header.Get("Authorization") != "Bearer qa-token" {
			t.Error("用量查詢路徑、方法或驗證錯誤")
		}
		w.Write([]byte(`{"metadata":{"name":"web","namespace":"dev"},"timestamp":"2026-09-24T00:00:00Z","window":"30s","containers":[{"name":"app","usage":{"cpu":"125000000n","memory":"64Mi"}},{"name":"sidecar","usage":{"cpu":"25m","memory":"32768Ki"}}]}`))
	})
	result, err := GetPodMetrics(raw, "dev", "web")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		CPUMilli, MemoryMiB, WindowSeconds float64
		Timestamp                          string
		Containers                         []struct {
			Name                string
			CPUMilli, MemoryMiB float64
		}
	}
	if json.Unmarshal([]byte(result), &got) != nil || got.CPUMilli != 150 || got.MemoryMiB != 96 || got.Timestamp != "2026-09-24T00:00:00Z" || got.WindowSeconds != 30 || len(got.Containers) != 2 || got.Containers[0].CPUMilli != 125 {
		t.Fatal(result)
	}
}

func TestPodMetricsUnitsZeroAndTinyValues(t *testing.T) {
	for _, tc := range []struct {
		cpu, memory         string
		wantCPU, wantMemory float64
	}{
		{"0", "0", 0, 0}, {"500u", "1Gi", 0.5, 1024}, {"0.25", "1048576", 250, 1}, {"2e-3", "1.048576e6", 2, 1}, {"1n", "1", 0.000001, 1.0 / 1048576},
	} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]any{"metadata": map[string]string{"name": "web", "namespace": "dev"}, "timestamp": "2026-09-24T08:00:00+08:00", "window": "1m0s", "containers": []any{map[string]any{"name": "app", "usage": map[string]string{"cpu": tc.cpu, "memory": tc.memory}}}})
		})
		result, err := GetPodMetrics(raw, "dev", "web")
		if err != nil {
			t.Fatal(err)
		}
		var got struct {
			CPUMilli, MemoryMiB float64
			Timestamp           string
		}
		json.Unmarshal([]byte(result), &got)
		if math.Abs(got.CPUMilli-tc.wantCPU) > 1e-12 || got.MemoryMiB != tc.wantMemory || got.Timestamp != "2026-09-24T00:00:00Z" {
			t.Fatal(result)
		}
	}
}
func TestPodMetricsInvalidDataNeverBecomesZero(t *testing.T) {
	for _, quantity := range []string{"", "-1", "NaN", "Inf", "1foo", "1e9999", "1e-9999", "1e30", "1e-320"} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			json.NewEncoder(w).Encode(map[string]any{"metadata": map[string]string{"name": "web", "namespace": "dev"}, "timestamp": "2026-09-24T00:00:00Z", "window": "30s", "containers": []any{map[string]any{"name": "app", "usage": map[string]string{"cpu": "1", "memory": quantity}}}})
		})
		if got, err := GetPodMetrics(raw, "dev", "web"); got != "" || err == nil || err.Error() != "metrics_invalid" {
			t.Fatalf("%s: %s %v", quantity, got, err)
		}
	}
}
func TestPodMetricsUnavailableAndErrors(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{401, "unauthorized"}, {403, "forbidden"}, {404, "metrics_missing"}, {503, "metrics_unavailable"}, {500, "api_failed"}, {302, "api_failed"}} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", "https://127.0.0.1:1")
			w.WriteHeader(tc.status)
			w.Write([]byte("secret error detail"))
		})
		got, err := GetPodMetrics(raw, "dev", "web")
		if got != "" || err == nil || err.Error() != tc.code {
			t.Fatalf("%d: %q %v", tc.status, got, err)
		}
	}
}

func TestPodMetricsIdentityCompletenessAndBounds(t *testing.T) {
	valid := `{"metadata":{"name":"web","namespace":"dev"},"timestamp":"2026-09-24T00:00:00Z","window":"30s","containers":[{"name":"app","usage":{"cpu":"0","memory":"0"}}]}`
	for _, body := range []string{
		strings.Replace(valid, `"name":"web"`, `"name":"other"`, 1),
		strings.Replace(valid, `"namespace":"dev"`, `"namespace":"other"`, 1),
		strings.Replace(valid, `"cpu":"0",`, ``, 1),
		strings.Replace(valid, `2026-09-24T00:00:00Z`, `not-time`, 1),
		strings.Replace(valid, `30s`, `0s`, 1),
		strings.Replace(valid, `"name":"app"`, `"name":"../app"`, 1),
		strings.Replace(valid, `[{"name":"app","usage":{"cpu":"0","memory":"0"}}]`, `[{"name":"app","usage":{"cpu":"0","memory":"0"}},{"name":"app","usage":{"cpu":"0","memory":"0"}}]`, 1),
		strings.Repeat("x", 2*1024*1024+1),
	} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) })
		got, err := GetPodMetrics(raw, "dev", "web")
		if got != "" || err == nil || err.Error() != "metrics_invalid" {
			t.Fatalf("無效資料：%q %v", got, err)
		}
	}
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"metadata":{"name":"web","namespace":"dev"},"containers":[]}`))
	})
	if _, err := GetPodMetrics(raw, "dev", "web"); err == nil || err.Error() != "metrics_missing" {
		t.Fatal(err)
	}
	if _, err := GetPodMetrics(raw, "dev", "../web"); err == nil || err.Error() != "invalid_resource" {
		t.Fatal(err)
	}
}

func TestListPodMetricsUsesOneBoundedRequest(t *testing.T) {
	requests := 0
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/apis/metrics.k8s.io/v1beta1/namespaces/dev/pods" || r.URL.Query().Get("limit") != "200" || r.Header.Get("Authorization") != "Bearer qa-token" {
			t.Error("清單用量請求錯誤")
		}
		w.Write([]byte(`{"items":[{"metadata":{"name":"web","namespace":"dev"},"timestamp":"2026-09-25T00:00:00Z","window":"30s","containers":[{"name":"app","usage":{"cpu":"24m","memory":"96Mi"}}]},{"metadata":{"name":"missing","namespace":"dev"},"containers":[]}]}`))
	})
	result, err := ListPodMetrics(raw, "dev")
	if err != nil {
		t.Fatal(err)
	}
	var metrics map[string]struct {
		CPUMilli  float64 `json:"cpuMilli"`
		MemoryMiB float64 `json:"memoryMiB"`
	}
	if json.Unmarshal([]byte(result), &metrics) != nil || len(metrics) != 1 || metrics["web"].CPUMilli != 24 || metrics["web"].MemoryMiB != 96 || requests != 1 {
		t.Fatal(result)
	}
}
func TestListPodMetricsDoesNotAcceptAnotherNamespace(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"items":[{"metadata":{"name":"web","namespace":"prod"}}]}`))
	})
	if _, err := ListPodMetrics(raw, "dev"); err == nil {
		t.Fatal("接受其他 namespace 的用量")
	}
}
