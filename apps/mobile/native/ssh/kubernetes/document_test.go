package mobilekubernetes

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func testDocument(kind string) map[string]any {
	route, k := documentRoute(kind)
	version := strings.TrimPrefix(strings.TrimPrefix(route, "apis/"), "api/")
	doc := map[string]any{"apiVersion": version, "kind": k, "metadata": map[string]any{"name": "web", "namespace": "dev", "uid": "id", "resourceVersion": "7", "managedFields": []any{}}, "status": map[string]any{"phase": "Running"}}
	spec := map[string]any{"containers": []any{map[string]any{"name": "app", "image": "nginx:old", "env": []any{map[string]any{"name": "MODE", "value": "yes"}}}, map[string]any{"name": "sidecar", "image": "helper:v1"}}, "initContainers": []any{map[string]any{"name": "setup", "image": "setup:v1"}}}
	if kind == "deployments" || kind == "statefulsets" {
		doc["spec"] = map[string]any{"replicas": 3, "template": map[string]any{"spec": spec}}
	} else if kind == "pods" {
		doc["spec"] = spec
	} else {
		doc["data"] = map[string]any{"enabled": "true", "number": "0123"}
	}
	return doc
}
func TestDocumentRoundTrip(t *testing.T) {
	for _, kind := range []string{"pods", "deployments", "statefulsets", "configmaps"} {
		t.Run(kind, func(t *testing.T) {
			writes := 0
			raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
				route, _ := documentRoute(kind)
				if r.URL.Path != "/"+route+"/namespaces/dev/"+kind+"/web" {
					t.Fatal("錯誤路徑")
				}
				doc := testDocument(kind)
				if r.Method == "PUT" {
					writes++
					doc = nil
					if json.NewDecoder(r.Body).Decode(&doc) != nil {
						t.Fatal("JSON 無效")
					}
					if kind == "configmaps" && (object(doc["data"])["enabled"] != "true" || object(doc["data"])["number"] != "0123") {
						t.Error("ConfigMap 字串型別改變")
					}
					if _, ok := doc["status"]; ok {
						t.Fatal("不應寫入 status")
					}
					if object(doc["metadata"])["resourceVersion"] != "7" {
						t.Fatal("缺少版本條件")
					}
					if r.URL.Query().Get("fieldValidation") != "Strict" {
						t.Fatal("缺少嚴格驗證")
					}
				}
				json.NewEncoder(w).Encode(doc)
			})
			got, err := GetDocument(raw, "dev", kind, "web")
			if err != nil {
				t.Fatal(err)
			}
			var value resourceDocument
			json.Unmarshal([]byte(got), &value)
			if strings.Contains(value.YAML, "managedFields") || strings.Contains(value.YAML, "status:") {
				t.Fatal("伺服器欄位未省略")
			}
			payload, _ := json.Marshal(documentChange{UID: value.UID, ResourceVersion: value.ResourceVersion, YAML: &value.YAML})
			if _, err = UpdateDocument(raw, "dev", kind, "web", string(payload)); err != nil || writes != 1 {
				t.Fatalf("%v writes=%d", err, writes)
			}
		})
	}
}
func TestImagePreservesOtherFields(t *testing.T) {
	for _, kind := range []string{"pods", "deployments", "statefulsets"} {
		for _, group := range []string{"containers", "initContainers"} {
			target := "app"
			if group == "initContainers" {
				target = "setup"
			}
			writes := 0
			raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
				doc := testDocument(kind)
				if r.Method == "PUT" {
					writes++
					json.NewDecoder(r.Body).Decode(&doc)
					spec := containerSpec(doc, kind)
					items := spec[group].([]any)
					if object(items[0])["image"] != "new:v2" {
						t.Fatal("image 未更新")
					}
					regular := spec["containers"].([]any)
					if object(regular[1])["image"] != "helper:v1" || object(regular[0])["env"] == nil {
						t.Fatal("覆蓋其他容器欄位")
					}
				}
				json.NewEncoder(w).Encode(doc)
			})
			payload, _ := json.Marshal(documentChange{UID: "id", ResourceVersion: "7", Container: &imageField{target, group, "new:v2"}})
			if _, err := UpdateDocument(raw, "dev", kind, "web", string(payload)); err != nil || writes != 1 {
				t.Fatal(err, writes)
			}
		}
	}
}
func TestInvalidYAMLNeverWrites(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { t.Error("無效輸入不可傳送") })
	for _, text := range []string{"a: 1\na: 2", "a: &x [1]\nb: *x", "a: 1\n---\nb: 2", "a: !!binary YQ==", "42: hello", strings.Repeat("x", documentLimit+1)} {
		payload, _ := json.Marshal(documentChange{UID: "id", ResourceVersion: "7", YAML: &text})
		if _, err := UpdateDocument(raw, "dev", "configmaps", "web", string(payload)); err == nil {
			t.Fatal("應拒絕無效 YAML")
		}
	}
	doc := testDocument("pods")
	object(doc["metadata"])["name"] = "other"
	b, _ := json.Marshal(doc)
	text := string(b)
	payload, _ := json.Marshal(documentChange{UID: "id", ResourceVersion: "7", YAML: &text})
	if _, err := UpdateDocument(raw, "dev", "pods", "web", string(payload)); err == nil || err.Error() != "document_identity" {
		t.Fatal(err)
	}
	if _, err := GetDocument(raw, "dev", "nodes", "web"); err == nil {
		t.Fatal("不接受未支援資源")
	}
}
func TestDocumentFailureDoesNotRetryOrLeak(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{403, "forbidden"}, {409, "scale_conflict"}, {422, "api_rejected"}, {500, "document_unknown"}, {302, "document_unknown"}} {
		writes := 0
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			writes++
			w.WriteHeader(tc.status)
			w.Write([]byte("private-content"))
		})
		b, _ := json.Marshal(testDocument("pods"))
		text := string(b)
		p, _ := json.Marshal(documentChange{UID: "id", ResourceVersion: "7", YAML: &text})
		out, err := UpdateDocument(raw, "dev", "pods", "web", string(p))
		if err == nil || err.Error() != tc.code || out != "" || writes != 1 {
			t.Fatal(out, err, writes)
		}
	}
}
func TestStaleImageDoesNotWrite(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("衝突不可寫入")
		}
		json.NewEncoder(w).Encode(testDocument("pods"))
	})
	p, _ := json.Marshal(documentChange{UID: "id", ResourceVersion: "old", Container: &imageField{"app", "containers", "new:v2"}})
	if _, err := UpdateDocument(raw, "dev", "pods", "web", string(p)); err == nil || err.Error() != "scale_conflict" {
		t.Fatal(err)
	}
}
