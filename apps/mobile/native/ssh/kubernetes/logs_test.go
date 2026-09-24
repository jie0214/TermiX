package mobilekubernetes

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPodContainersAndRecentLogs(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer qa-token" {
			t.Error("驗證或唯讀方法錯誤")
		}
		switch r.URL.Path {
		case "/api/v1/namespaces/dev/pods/web":
			w.Write([]byte(`{"metadata":{"name":"web","namespace":"dev"},"spec":{"containers":[{"name":"app"},{"name":"sidecar"}],"initContainers":[{"name":"setup"}],"ephemeralContainers":[{"name":"debug"}]}}`))
		case "/api/v1/namespaces/dev/pods/web/log":
			q := r.URL.Query()
			if q.Get("container") != "sidecar" || q.Get("previous") != "true" || q.Get("follow") != "false" || q.Get("tailLines") != "200" || q.Get("limitBytes") != "65536" || q.Get("timestamps") != "true" {
				t.Errorf("參數錯誤：%v", q)
			}
			w.Write([]byte("2026-09-23T00:00:00Z hello\n第二行\n"))
		default:
			t.Error("路徑錯誤")
			w.WriteHeader(404)
		}
	})
	options, err := GetPodContainers(raw, "dev", "web")
	if err != nil {
		t.Fatal(err)
	}
	var containers struct{ Containers []struct{ Name, Kind string } }
	json.Unmarshal([]byte(options), &containers)
	if len(containers.Containers) != 4 || containers.Containers[0].Name != "app" || containers.Containers[2].Kind != "init" || containers.Containers[3].Kind != "ephemeral" {
		t.Fatal(options)
	}
	result, err := GetPodLogs(raw, "dev", "web", "sidecar", true)
	if err != nil {
		t.Fatal(err)
	}
	var log struct {
		Text      string
		Truncated bool
	}
	json.Unmarshal([]byte(result), &log)
	if log.Text != "2026-09-23T00:00:00Z hello\n第二行\n" || log.Truncated {
		t.Fatal(result)
	}
}

func TestLogErrorsNeverExposeServerBody(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{400, "logs_unavailable"}, {401, "unauthorized"}, {403, "forbidden"}, {404, "not_found"}, {500, "api_failed"}, {302, "api_failed"}} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", "https://127.0.0.1:1")
			w.WriteHeader(tc.status)
			w.Write([]byte("server-secret-body"))
		})
		result, err := GetPodLogs(raw, "dev", "web", "app", false)
		if result != "" || err == nil || err.Error() != tc.code {
			t.Fatalf("預期 %s，取得 %q %v", tc.code, result, err)
		}
	}
	raw := config("https://127.0.0.1:1", "", "qa-token")
	for _, names := range [][2]string{{"../other", "app"}, {"web", "a&follow=true"}, {"web", ""}} {
		if _, err := GetPodLogs(raw, "dev", names[0], names[1], false); err == nil || err.Error() != "invalid_resource" {
			t.Fatal(err)
		}
	}
}
func TestLogResponseBoundsAndEmpty(t *testing.T) {
	for _, tc := range []struct {
		body      string
		truncated bool
		maxLength int
	}{
		{"", false, 0}, {strings.Repeat("x", 70000), true, 65536}, {strings.Repeat("line\n", 250), true, 1000},
		{string([]byte{0xff, 0xfe}) + "正常", false, 20},
	} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(tc.body)) })
		result, err := GetPodLogs(raw, "dev", "web", "app", false)
		if err != nil {
			t.Fatal(err)
		}
		var got struct {
			Text      string
			Truncated bool
		}
		json.Unmarshal([]byte(result), &got)
		if got.Truncated != tc.truncated || len(got.Text) > tc.maxLength || !utf8.ValidString(got.Text) {
			t.Fatalf("長度 %d 截斷 %v", len(got.Text), got.Truncated)
		}
	}
}
func TestPodContainerIdentityAndValidation(t *testing.T) {
	for _, body := range []string{
		`{"metadata":{"name":"other","namespace":"dev"},"spec":{"containers":[{"name":"app"}]}}`,
		`{"metadata":{"name":"web","namespace":"other"},"spec":{"containers":[{"name":"app"}]}}`,
		`{"metadata":{"name":"web","namespace":"dev"},"spec":{"containers":[]}}`,
		`{"metadata":{"name":"web","namespace":"dev"},"spec":{"containers":[{"name":"app"},{"name":"app"}]}}`,
	} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) })
		if _, err := GetPodContainers(raw, "dev", "web"); err == nil || err.Error() != "api_failed" {
			t.Fatal(err)
		}
	}
}

func TestPodLogsNegotiatesAPIResponseBeforeTextStream(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "text/plain" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotAcceptable)
			return
		}
		if r.URL.Path != "/api/v1/namespaces/dev/pods/web/log" {
			t.Error("Log 路徑錯誤")
		}
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("fixture-log\n"))
	})
	result, err := GetPodLogs(raw, "dev", "web", "app", false)
	if err != nil {
		t.Fatalf("Log 應成功讀取，而不是顯示叢集回應無效：%v", err)
	}
	var output struct {
		Text string `json:"text"`
	}
	if json.Unmarshal([]byte(result), &output) != nil || output.Text != "fixture-log\n" {
		t.Fatal("未收到文字 Log")
	}
}
