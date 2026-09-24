package mobilekubernetes

import (
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAWSProfileSelectionIsContextLocal(t *testing.T) {
	raw := eksConfig("https://example.com", "") + "- name: other\n  context: {cluster: local, user: user, namespace: prod}\n"
	updated, err := SelectAWSProfile(raw, "mobile")
	if err != nil {
		t.Fatal(err)
	}
	selected, err := selectConfig(updated)
	if err != nil {
		t.Fatal(err)
	}
	key, _ := AWSProfileKey("ap-northeast-1", "mobile")
	if selected.EKS.Profile != "mobile" || selected.EKS.CredentialKey != key || selected.EKS.Region != "ap-northeast-1" || selected.EKS.ClusterName != "qa-cluster" {
		t.Fatal("錯誤 profile 綁定")
	}
	if !strings.Contains(updated, "qa-profile") {
		t.Fatal("不應覆寫原始 exec")
	}
	other, err := SelectContext(updated, "other")
	if err != nil {
		t.Fatal(err)
	}
	selected, err = selectConfig(other)
	if err != nil || selected.EKS.Profile != "qa-profile" {
		t.Fatal("影響其他 context")
	}
	restored, err := SelectAWSProfile(updated, "")
	if err != nil {
		t.Fatal(err)
	}
	selected, err = selectConfig(restored)
	if err != nil || selected.EKS.Profile != "qa-profile" {
		t.Fatal("無法回復預設")
	}
	if _, err = SelectAWSProfile(raw, "bad profile"); err == nil {
		t.Fatal("接受無效 profile")
	}
	if _, err = SelectAWSProfile(config("https://example.com", "", "token"), "mobile"); err == nil {
		t.Fatal("非 EKS 不應接受 AWS profile")
	}
}

func TestNamespacePagesAndAuthorization(t *testing.T) {
	forbidden := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces" || r.URL.Query().Get("limit") != "200" || r.Header.Get("Authorization") != "Bearer ns-token" {
			t.Error("錯誤 namespace 請求")
			w.WriteHeader(400)
			return
		}
		if forbidden {
			w.WriteHeader(403)
			return
		}
		if r.URL.Query().Get("continue") == "next/token?" {
			w.Write([]byte(`{"metadata":{},"items":[{"metadata":{"name":"prod"}}]}`))
			return
		}
		w.Write([]byte(`{"metadata":{"continue":"next/token?"},"items":[{"metadata":{"name":"dev"}},{"metadata":{"name":"default"}}]}`))
	}))
	defer server.Close()
	raw := config(server.URL, base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})), "ns-token")
	result, err := ListNamespaces(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if result != `{"items":["default","dev"],"cursor":"next/token?"}` {
		t.Fatal(result)
	}
	result, err = ListNamespaces(raw, "next/token?")
	if err != nil || result != `{"items":["prod"],"cursor":""}` {
		t.Fatal(result, err)
	}
	forbidden = true
	if _, err = ListNamespaces(raw, ""); err == nil || err.Error() != "namespaces_forbidden" {
		t.Fatal(err)
	}
}

func TestPublicResourceHealthSummaries(t *testing.T) {
	payload := ""
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(payload)) }))
	defer server.Close()
	raw := config(server.URL, base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})), "health-token")
	cases := []struct{ kind, status, want string }{
		{"pods", `"phase":"Running","conditions":[{"type":"Ready","status":"True"}]`, "healthy"},
		{"pods", `"phase":"Running","conditions":[{"type":"Ready","status":"False"}]`, "unhealthy"},
		{"pods", `"phase":"Pending","containerStatuses":[{"state":{"waiting":{"reason":"ImagePullBackOff"}}}]`, "unhealthy"},
		{"pods", `"phase":"Running","initContainerStatuses":[{"state":{"waiting":{"reason":"CrashLoopBackOff"}}}]`, "unhealthy"},
		{"pods", `"phase":"Pending"`, "pending"},
		{"pods", `"phase":"Succeeded"`, "completed"},
		{"pods", `"phase":"Failed"`, "unhealthy"},
		{"pods", `"phase":"Running"`, "unknown"},
		{"deployments", `"observedGeneration":2,"readyReplicas":2,"availableReplicas":2`, "healthy"},
		{"deployments", `"observedGeneration":1,"readyReplicas":2,"availableReplicas":2`, "pending"},
		{"deployments", `"observedGeneration":2,"readyReplicas":2,"availableReplicas":1`, "unhealthy"},
		{"deployments", `"observedGeneration":2,"readyReplicas":2,"availableReplicas":2,"conditions":[{"type":"Progressing","status":"False"}]`, "unhealthy"},
		{"statefulsets", `"observedGeneration":2,"readyReplicas":2`, "healthy"},
		{"statefulsets", `"observedGeneration":2,"readyReplicas":1`, "unhealthy"},
		{"statefulsets", `"readyReplicas":2`, "unknown"},
	}
	for _, c := range cases {
		t.Run(c.kind+"/"+c.want+"/"+c.status, func(t *testing.T) {
			payload = `{"items":[{"metadata":{"name":"api","namespace":"dev","generation":2},"spec":{"replicas":2},"status":{` + c.status + `}}]}`
			var result string
			var err error
			if c.kind == "pods" {
				result, err = ListPods(raw, "dev")
			} else {
				result, err = ListResources(raw, "dev", c.kind)
			}
			if err != nil {
				t.Fatal(err)
			}
			var decoded struct {
				Items []struct {
					Health string `json:"health"`
				} `json:"items"`
			}
			if json.Unmarshal([]byte(result), &decoded) != nil || len(decoded.Items) != 1 || decoded.Items[0].Health != c.want {
				t.Fatal(result)
			}
		})
	}
	payload = `{"items":[{"metadata":{"name":"api","namespace":"dev","generation":2},"spec":{"replicas":0},"status":{"observedGeneration":2}}]}`
	result, err := ListResources(raw, "dev", "deployments")
	if err != nil || !strings.Contains(result, `"health":"stopped"`) {
		t.Fatal(result, err)
	}
}
