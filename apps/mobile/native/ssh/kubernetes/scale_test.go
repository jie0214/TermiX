package mobilekubernetes

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestScaleReadAndConditionalUpdate(t *testing.T) {
	for _, kind := range []string{"deployments", "statefulsets"} {
		writes := 0
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/apis/apps/v1/namespaces/dev/"+kind+"/web/scale" || r.Header.Get("Authorization") != "Bearer qa-token" {
				t.Error("路徑或授權錯誤")
			}
			replicas := 3
			if r.Method == "PUT" {
				writes++
				var body struct {
					APIVersion, Kind string
					Metadata         struct{ Name, Namespace, UID, ResourceVersion string }
					Spec             struct{ Replicas int }
				}
				if json.NewDecoder(r.Body).Decode(&body) != nil || body.APIVersion != "autoscaling/v1" || body.Kind != "Scale" || body.Metadata.Name != "web" || body.Metadata.Namespace != "dev" || body.Metadata.UID != "uid-1" || body.Metadata.ResourceVersion != "42" || body.Spec.Replicas != 0 || r.Header.Get("Content-Type") != "application/json" {
					t.Error("更新未保留身分／版本條件或零副本")
				}
				replicas = 0
			} else if r.Method != "GET" {
				t.Error("方法錯誤")
			}
			json.NewEncoder(w).Encode(map[string]any{"apiVersion": "autoscaling/v1", "kind": "Scale", "metadata": map[string]string{"name": "web", "namespace": "dev", "uid": "uid-1", "resourceVersion": "42"}, "spec": map[string]int{"replicas": replicas}})
		})
		got, err := GetScale(raw, "dev", kind, "web")
		if err != nil {
			t.Fatal(err)
		}
		var scale struct {
			UID, ResourceVersion string
			Replicas             int
		}
		json.Unmarshal([]byte(got), &scale)
		if scale.UID != "uid-1" || scale.ResourceVersion != "42" || scale.Replicas != 3 {
			t.Fatal(got)
		}
		got, err = UpdateScale(raw, "dev", kind, "web", `{"uid":"uid-1","resourceVersion":"42","replicas":0}`)
		if err != nil || writes != 1 {
			t.Fatalf("%s %v", got, err)
		}
		json.Unmarshal([]byte(got), &scale)
		if scale.Replicas != 0 {
			t.Fatal(got)
		}
	}
}

func TestScaleFailureNeverRetriesOrLeaks(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{401, "unauthorized"}, {403, "forbidden"}, {404, "not_found"}, {409, "scale_conflict"}, {422, "api_rejected"}, {500, "scale_unknown"}, {302, "scale_unknown"}} {
		writes := 0
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			writes++
			w.Header().Set("Location", "https://127.0.0.1:1")
			w.WriteHeader(tc.status)
			w.Write([]byte("private server details"))
		})
		got, err := UpdateScale(raw, "dev", "deployments", "web", `{"uid":"id","resourceVersion":"7","replicas":2}`)
		if got != "" || err == nil || err.Error() != tc.code || writes != 1 {
			t.Fatalf("%d: %q %v writes=%d", tc.status, got, err, writes)
		}
	}
}
func TestScaleInvalidInputNeverSends(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) { t.Error("無效輸入不可傳送") })
	for _, payload := range []string{`{}`, `{"uid":"id","resourceVersion":"7","replicas":-1}`, `{"uid":"id","resourceVersion":"7","replicas":1.5}`, `{"uid":"id","resourceVersion":"7","replicas":2147483648}`, `{"uid":"id","replicas":2}`} {
		if _, err := UpdateScale(raw, "dev", "deployments", "web", payload); err == nil || err.Error() != "invalid_scale" {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{"pods", "configmaps", "../deployments"} {
		if _, err := GetScale(raw, "dev", kind, "web"); err == nil || err.Error() != "invalid_resource" {
			t.Fatal(err)
		}
	}
	if _, err := GetScale(raw, "dev", "deployments", "../other"); err == nil {
		t.Fatal("不可接受路徑")
	}
}
func TestScaleMalformedSuccessIsUncertain(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"metadata":{"name":"other","namespace":"dev"}}`))
	})
	if _, err := UpdateScale(raw, "dev", "deployments", "web", `{"uid":"id","resourceVersion":"7","replicas":2}`); err == nil || err.Error() != "scale_unknown" {
		t.Fatal(err)
	}
}

func TestScaleResponseMustMatchConfirmedUID(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"apiVersion":"autoscaling/v1","kind":"Scale","metadata":{"name":"web","namespace":"dev","uid":"replacement","resourceVersion":"9"},"spec":{"replicas":2}}`))
	})
	if _, err := UpdateScale(raw, "dev", "deployments", "web", `{"uid":"original","resourceVersion":"7","replicas":2}`); err == nil || err.Error() != "scale_unknown" {
		t.Fatal("不同 UID 不得宣稱成功", err)
	}
}
