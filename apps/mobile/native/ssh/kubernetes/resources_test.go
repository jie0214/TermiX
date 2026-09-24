package mobilekubernetes

import (
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func resourceServer(t *testing.T, handler http.HandlerFunc) string {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	ca := base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}))
	return config(server.URL, ca, "qa-token")
}
func TestListWorkloads(t *testing.T) {
	for _, kind := range []string{"deployments", "statefulsets"} {
		t.Run(kind, func(t *testing.T) {
			raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/apis/apps/v1/namespaces/dev/"+kind || r.URL.RawQuery != "limit=200" || r.Header.Get("Authorization") != "Bearer qa-token" {
					t.Error("查詢路徑或驗證錯誤")
				}
				w.Write([]byte(`{"metadata":{"continue":"next"},"items":[{"metadata":{"name":"api","namespace":"dev"},"spec":{"replicas":3},"status":{"readyReplicas":2,"updatedReplicas":1}},{"metadata":{"name":"paused","namespace":"dev"},"spec":{"replicas":0}}]}`))
			})
			result, err := ListResources(raw, "dev", kind)
			if err != nil {
				t.Fatal(err)
			}
			var list struct {
				Items []struct {
					Name                    string
					Ready, Desired, Updated int
				}
				HasMore bool
			}
			if err = json.Unmarshal([]byte(result), &list); err != nil {
				t.Fatal(err)
			}
			if len(list.Items) != 2 || list.Items[0].Ready != 2 || list.Items[0].Desired != 3 || list.Items[0].Updated != 1 || list.Items[1].Desired != 0 || !list.HasMore {
				t.Fatal(result)
			}
		})
	}
}

func TestConfigMapListAndDetail(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("非唯讀請求")
		}
		item := `{"metadata":{"name":"settings","namespace":"dev"},"immutable":true,"data":{"app.conf":"mode=prod\nworkers=2"},"binaryData":{"asset":"AAEC"}}`
		switch r.URL.Path {
		case "/api/v1/namespaces/dev/configmaps":
			w.Write([]byte(`{"items":[` + item + `]}`))
		case "/api/v1/namespaces/dev/configmaps/settings":
			if r.URL.RawQuery != "" {
				t.Error("明細不應含清單參數")
			}
			w.Write([]byte(item))
		default:
			t.Error("非預期路徑")
			w.WriteHeader(404)
		}
	})
	list, err := ListResources(raw, "dev", "configmaps")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(list, "mode=prod") || !strings.Contains(list, `"keyCount":2`) || !strings.Contains(list, `"immutable":true`) {
		t.Fatal(list)
	}
	detail, err := GetConfigMap(raw, "dev", "settings")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Entries []struct {
			Key, Value string
			Binary     bool
			Bytes      int
		}
		Truncated bool
	}
	if err = json.Unmarshal([]byte(detail), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Entries) != 2 || got.Entries[0].Value != "mode=prod\nworkers=2" || got.Entries[1].Key != "asset" || !got.Entries[1].Binary || got.Entries[1].Bytes != 3 || got.Truncated {
		t.Fatal(detail)
	}
}

func TestResourceFailuresAndBounds(t *testing.T) {
	for _, tc := range []struct {
		code       int
		body, want string
	}{
		{401, "", "unauthorized"}, {403, "", "forbidden"}, {404, "", "not_found"}, {500, "", "api_failed"},
		{200, `{}`, "api_failed"}, {200, `{"items":[{"metadata":{"name":"x","namespace":"other"}}]}`, "api_failed"},
		{200, `{"items":[{"metadata":{"name":"x","namespace":"dev"},"spec":{"replicas":-1}}]}`, "api_failed"},
		{200, strings.Repeat("x", 2*1024*1024+1), "api_failed"},
	} {
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.code); w.Write([]byte(tc.body)) })
		_, err := ListResources(raw, "dev", "deployments")
		if err == nil || err.Error() != tc.want {
			t.Fatalf("預期 %s，取得 %v", tc.want, err)
		}
	}
	raw := config("https://127.0.0.1:1", "", "qa-token")
	for _, kind := range []string{"secrets", "../pods", ""} {
		if _, err := ListResources(raw, "dev", kind); err == nil || err.Error() != "invalid_resource" {
			t.Fatalf("非法類型：%v", err)
		}
	}
	if _, err := GetConfigMap(raw, "dev", "../secrets"); err == nil || err.Error() != "invalid_resource" {
		t.Fatal(err)
	}
	if _, err := ListResources(raw, "../dev", "deployments"); err == nil || err.Error() != "invalid_namespace" {
		t.Fatal(err)
	}
}
func TestConfigMapDetailPreviewLimitsAndIdentity(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"metadata": map[string]string{"name": "settings", "namespace": "dev"}, "data": map[string]string{"long": strings.Repeat("繁", 5000)}})
	})
	detail, err := GetConfigMap(raw, "dev", "settings")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Entries []struct {
			Value     string
			Truncated bool
		}
		Truncated bool
	}
	json.Unmarshal([]byte(detail), &got)
	if len(got.Entries) != 1 || len([]rune(got.Entries[0].Value)) != 4096 || !got.Entries[0].Truncated || !got.Truncated {
		t.Fatal("預覽未正確截斷")
	}
	if _, err = GetConfigMap(raw, "dev", "other"); err == nil || err.Error() != "api_failed" {
		t.Fatal("接受錯誤資源")
	}
	raw = resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		data := map[string]string{}
		for i := 0; i < 201; i++ {
			data[fmt.Sprintf("key-%03d", i)] = ""
		}
		json.NewEncoder(w).Encode(map[string]any{"metadata": map[string]string{"name": "settings", "namespace": "dev"}, "data": data})
	})
	detail, err = GetConfigMap(raw, "dev", "settings")
	if err != nil {
		t.Fatal(err)
	}
	json.Unmarshal([]byte(detail), &got)
	if len(got.Entries) != 200 || !got.Truncated {
		t.Fatal("項目數未限制")
	}
}
