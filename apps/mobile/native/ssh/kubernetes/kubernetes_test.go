package mobilekubernetes

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func config(server, ca, token string) string {
	return "apiVersion: v1\nkind: Config\ncurrent-context: lab\nclusters:\n- name: local\n  cluster:\n    server: " + server + "\n    certificate-authority-data: " + ca + "\nusers:\n- name: user\n  user:\n    token: " + token + "\ncontexts:\n- name: lab\n  context:\n    cluster: local\n    user: user\n    namespace: dev\n"
}
func TestInspectAndListPodsThroughVerifiedTLS(t *testing.T) {
	var requests int
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/api/v1/namespaces/dev/pods" || r.URL.Query().Get("limit") != "200" || r.Header.Get("Authorization") != "Bearer qa-token" {
			t.Errorf("unexpected request %s %s", r.URL, r.Header.Get("Authorization"))
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"items":[{"metadata":{"name":"pod-a","namespace":"dev"},"spec":{"containers":[{"name":"a"},{"name":"b"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true},{"ready":false}]}}]}`))
	}))
	defer server.Close()
	cert := server.Certificate()
	// certificate-authority-data 是 PEM，而不是 DER。
	pemCA := base64.StdEncoding.EncodeToString([]byte("-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(cert.Raw) + "\n-----END CERTIFICATE-----\n"))
	raw := config(server.URL, pemCA, "qa-token")
	metadata, err := Inspect(raw)
	if err != nil {
		t.Fatal(err)
	}
	if metadata != `{"context":"lab","cluster":"local","namespace":"dev"}` {
		t.Fatal(metadata)
	}
	pods, err := ListPods(raw, "dev")
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Items []struct {
			Name  string `json:"name"`
			Phase string `json:"phase"`
			Ready int    `json:"ready"`
			Total int    `json:"total"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(pods), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "pod-a" || result.Items[0].Phase != "Running" || result.Items[0].Ready != 1 || result.Items[0].Total != 2 || requests != 1 {
		t.Fatalf("bad result %s requests %d", pods, requests)
	}
}
func TestRejectUnsafeAndUnsupportedBeforeNetwork(t *testing.T) {
	base := config("https://127.0.0.1:1", "", "qa-token")
	cases := []struct{ raw, code string }{
		{strings.Replace(base, "https://127.0.0.1:1", "http://127.0.0.1:1", 1), "insecure_tls"},
		{strings.Replace(base, "    token: qa-token", "    exec: {command: echo}", 1), "unsupported_eks_exec"},
		{strings.Replace(base, "    token: qa-token", "    client-certificate-data: test", 1), "certificate_incomplete"},
		{strings.Replace(base, "    token: qa-token", "    token: ''", 1), "missing_token"},
		{strings.Replace(base, "server: https://", "insecure-skip-tls-verify: true\n    server: https://", 1), "insecure_tls"},
		{"bad yaml: [", "config_invalid"},
	}
	for _, tc := range cases {
		_, err := Inspect(tc.raw)
		if err == nil || err.Error() != tc.code {
			t.Errorf("expected %s, got %v", tc.code, err)
		}
	}
	if _, err := ListPods(base, "../secret"); err == nil || err.Error() != "invalid_namespace" {
		t.Errorf("namespace: %v", err)
	}
}

func TestTLSFailureAndBearerTokenNeverFollowRedirect(t *testing.T) {
	var leaked bool
	redirectTarget := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = true
		w.WriteHeader(http.StatusOK)
	}))
	defer redirectTarget.Close()
	source := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, redirectTarget.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	pemCA := base64.StdEncoding.EncodeToString([]byte("-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(source.Certificate().Raw) + "\n-----END CERTIFICATE-----\n"))
	raw := config(source.URL, pemCA, "qa-token")
	if _, err := ListPods(raw, "dev"); err == nil || err.Error() != "api_failed" {
		t.Fatalf("redirect: %v", err)
	}
	if leaked {
		t.Fatal("redirect followed")
	}
	if _, err := ListPods(config(source.URL, "", "qa-token"), "dev"); err == nil || err.Error() != "connection_failed" {
		t.Fatalf("TLS: %v", err)
	}
}

func TestAuthorizationAndBoundedResponse(t *testing.T) {
	response := http.StatusForbidden
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(response)
		if response == http.StatusOK {
			w.Write([]byte(`{"items":[]}`))
		}
	}))
	defer server.Close()
	pemCA := base64.StdEncoding.EncodeToString([]byte("-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(server.Certificate().Raw) + "\n-----END CERTIFICATE-----\n"))
	raw := config(server.URL, pemCA, "qa-token")
	if _, err := ListPods(raw, "dev"); err == nil || err.Error() != "forbidden" {
		t.Fatalf("403: %v", err)
	}
	response = http.StatusUnauthorized
	if _, err := ListPods(raw, "dev"); err == nil || err.Error() != "unauthorized" {
		t.Fatalf("401: %v", err)
	}
	response = http.StatusOK
	result, err := ListPods(raw, "dev")
	if err != nil || !strings.Contains(result, `"items":[]`) {
		t.Fatalf("empty: %s %v", result, err)
	}
}

func TestPendingPodUsesDesiredContainerCount(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"items":[{"metadata":{"name":"starting","namespace":"dev"},"spec":{"containers":[{"name":"api"},{"name":"sidecar"}]},"status":{"phase":"Pending"}}]}`))
	}))
	defer server.Close()
	ca := base64.StdEncoding.EncodeToString([]byte("-----BEGIN CERTIFICATE-----\n" + base64.StdEncoding.EncodeToString(server.Certificate().Raw) + "\n-----END CERTIFICATE-----\n"))
	result, err := ListPods(config(server.URL, ca, "qa-token"), "dev")
	if err != nil || !strings.Contains(result, `"ready":0,"total":2`) {
		t.Fatalf("pending: %s %v", result, err)
	}
}
