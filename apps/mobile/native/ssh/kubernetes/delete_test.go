package mobilekubernetes

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestDeleteConditionalAndAcceptedResponses(t *testing.T) {
	for _, code := range []int{200, 202, 204} {
		writes := 0
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			writes++
			if r.Method != "DELETE" || r.URL.Path != "/apis/apps/v1/namespaces/dev/deployments/web" {
				t.Error("刪除目標錯誤")
			}
			var body struct {
				Preconditions     struct{ UID, ResourceVersion string }
				PropagationPolicy string
			}
			if json.NewDecoder(r.Body).Decode(&body) != nil || body.Preconditions.UID != "original" || body.Preconditions.ResourceVersion != "7" || body.PropagationPolicy != "Background" {
				t.Error("未帶入確認條件")
			}
			w.WriteHeader(code)
			if code != 204 {
				w.Write([]byte(`{"apiVersion":"v1","kind":"Status","status":"Success"}`))
			}
		})
		if _, err := DeleteResource(raw, "dev", "deployments", "web", `{"uid":"original","resourceVersion":"7"}`); err != nil || writes != 1 {
			t.Fatal(err, writes)
		}
	}
}
func TestDeleteFailuresNeverRetry(t *testing.T) {
	for _, tc := range []struct {
		status   int
		expected string
	}{{403, "forbidden"}, {404, "not_found"}, {409, "scale_conflict"}, {500, "delete_unknown"}} {
		writes := 0
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { writes++; w.WriteHeader(tc.status) })
		if _, err := DeleteResource(raw, "dev", "configmaps", "web", `{"uid":"original","resourceVersion":"7"}`); err == nil || err.Error() != tc.expected || writes != 1 {
			t.Fatal(err, writes)
		}
	}
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { t.Error("無條件刪除不可送出") })
	for _, payload := range []string{`{}`, `{"uid":"id"}`, `{"uid":"","resourceVersion":"7"}`} {
		if _, err := DeleteResource(raw, "dev", "pods", "web", payload); err == nil {
			t.Fatal("接受無效刪除")
		}
	}
}
