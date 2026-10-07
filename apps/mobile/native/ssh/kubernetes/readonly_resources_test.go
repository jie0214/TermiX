package mobilekubernetes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestReadOnlyResourceCatalog(t *testing.T) {
	cases := []struct{ resource, kind, route, fields, detail string }{
		{"horizontalpodautoscalers", "HorizontalPodAutoscaler", "apis/autoscaling/v2", `"spec":{"scaleTargetRef":{"kind":"Deployment","name":"web"},"minReplicas":0,"maxReplicas":5},"status":{"currentReplicas":2,"desiredReplicas":3}`, "Deployment/web · Replicas 2 → 3 · Min 0 / Max 5"},
		{"poddisruptionbudgets", "PodDisruptionBudget", "apis/policy/v1", `"status":{"currentHealthy":2,"desiredHealthy":1,"disruptionsAllowed":1}`, "Healthy 2 / Desired 1 · Disruptions allowed 1"},
		{"networkpolicies", "NetworkPolicy", "apis/networking.k8s.io/v1", `"spec":{"policyTypes":["Ingress","Egress"]}`, "Policy types: Ingress, Egress"},
		{"endpointslices", "EndpointSlice", "apis/discovery.k8s.io/v1", `"addressType":"IPv4","endpoints":[{"addresses":["10.0.0.1"],"conditions":{"ready":true}},{"addresses":["10.0.0.2"]}]`, "IPv4 · Endpoints 2 · Ready 1 · Unknown 1"},
		{"serviceaccounts", "ServiceAccount", "api/v1", `"automountServiceAccountToken":false,"imagePullSecrets":[{"name":"pull"}]`, "Token automount false · Image pull secrets 1"},
		{"roles", "Role", "apis/rbac.authorization.k8s.io/v1", `"rules":[{"verbs":["get"],"resources":["pods"]}]`, "Rules 1"},
		{"rolebindings", "RoleBinding", "apis/rbac.authorization.k8s.io/v1", `"roleRef":{"kind":"Role","name":"reader"},"subjects":[{"kind":"ServiceAccount","name":"web"}]`, "Role/reader · Subjects 1"},
		{"resourcequotas", "ResourceQuota", "api/v1", `"status":{"hard":{"pods":"10","requests.cpu":"4"},"used":{"pods":"3"}}`, "pods 3 / 10 · requests.cpu Unknown / 4"},
		{"limitranges", "LimitRange", "api/v1", `"spec":{"limits":[{"type":"Container","max":{"cpu":"2"}}]}`, "Limits: Container"},
	}
	for _, tc := range cases {
		t.Run(tc.resource, func(t *testing.T) {
			version := strings.TrimPrefix(strings.TrimPrefix(tc.route, "apis/"), "api/")
			doc := fmt.Sprintf(`{"apiVersion":%q,"kind":%q,"metadata":{"name":"web","namespace":"dev","uid":"id","resourceVersion":"7"},%s}`, version, tc.kind, tc.fields)
			requests := 0
			raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
				requests++
				if r.Method != "GET" {
					t.Errorf("唯讀資源送出 %s", r.Method)
				}
				base := "/" + tc.route + "/namespaces/dev/" + tc.resource
				switch r.URL.Path {
				case base:
					fmt.Fprintf(w, `{"metadata":{"continue":"next"},"items":[%s]}`, doc)
				case base + "/web":
					fmt.Fprint(w, doc)
				default:
					t.Error(r.URL.Path)
					http.NotFound(w, r)
				}
			})
			result, err := ListResources(raw, "dev", tc.resource)
			if err != nil {
				t.Fatal(err)
			}
			var list struct {
				Items   []resourceSummary
				HasMore bool
			}
			if json.Unmarshal([]byte(result), &list) != nil || len(list.Items) != 1 || list.Items[0].Detail != tc.detail || !list.HasMore {
				t.Fatal(result)
			}
			result, err = GetDocument(raw, "dev", tc.resource, "web")
			if err != nil || !strings.Contains(result, tc.kind) {
				t.Fatal(result, err)
			}
			if strings.Contains(tc.fields, `"status"`) && !strings.Contains(result, "status:") {
				t.Fatal("唯讀 YAML 遺失狀態", result)
			}
			before := requests
			if _, err = UpdateDocument(raw, "dev", tc.resource, "web", `{}`); err == nil || err.Error() != "api_rejected" {
				t.Fatal(err)
			}
			if _, err = DeleteResource(raw, "dev", tc.resource, "web", `{"uid":"id","resourceVersion":"7"}`); err == nil || err.Error() != "api_rejected" {
				t.Fatal(err)
			}
			if requests != before {
				t.Fatal("唯讀寫入不得送出請求")
			}
		})
	}
}

func TestReadOnlyResourceFailures(t *testing.T) {
	for _, code := range []int{http.StatusForbidden, http.StatusNotFound} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(code) })
			if result, err := ListResources(raw, "dev", "roles"); err == nil || result != "" {
				t.Fatal(result, err)
			}
		})
	}
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"items":[{"metadata":{"name":"web","namespace":"other"}}]}`)
	})
	if _, err := ListResources(raw, "dev", "roles"); err == nil {
		t.Fatal("不可接受其他 namespace 資源")
	}
}
