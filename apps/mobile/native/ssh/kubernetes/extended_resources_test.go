package mobilekubernetes

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestExtendedResourceRoutesAndSafeSummaries(t *testing.T) {
	for _, kind := range []string{"daemonsets", "replicasets", "jobs", "cronjobs", "services", "ingresses", "secrets", "persistentvolumeclaims"} {
		route, _ := documentRoute(kind)
		raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/"+route+"/namespaces/dev/"+kind {
				t.Error(r.URL.Path)
			}
			w.Write([]byte(`{"items":[{"metadata":{"name":"web","namespace":"dev"},"spec":{"replicas":0,"type":"ClusterIP","clusterIP":"10.0.0.1","ports":[{"port":80,"protocol":"TCP"}],"schedule":"0 0 * * *"},"status":{"desiredNumberScheduled":2,"numberReady":1,"phase":"Bound","capacity":{"storage":"10Gi"}},"data":{"token":"private-value"}}]}`))
		})
		result, err := ListResources(raw, "dev", kind)
		if err != nil || strings.Contains(result, "private-value") {
			t.Fatal(kind, result, err)
		}
		var list struct{ Items []resourceSummary }
		json.Unmarshal([]byte(result), &list)
		if len(list.Items) != 1 {
			t.Fatal(result)
		}
		if kind == "daemonsets" && (list.Items[0].Ready != 1 || list.Items[0].Desired != 2) {
			t.Fatal(result)
		}
		if kind == "replicasets" && list.Items[0].Desired != 0 {
			t.Fatal(result)
		}
	}
}
func TestSecretDocumentRedactsValuesAndRejectsEdits(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Fatal("Secret 不可寫入")
		}
		w.Write([]byte(`{"apiVersion":"v1","kind":"Secret","metadata":{"name":"web","namespace":"dev","uid":"id","resourceVersion":"7","annotations":{"last-applied":"private-value"}},"data":{"token":"private-value"},"stringData":{"token":"private-value"}}`))
	})
	result, err := GetDocument(raw, "dev", "secrets", "web")
	if err != nil || strings.Contains(result, "private-value") {
		t.Fatal(result, err)
	}
	if _, err = UpdateDocument(raw, "dev", "secrets", "web", `{}`); err == nil {
		t.Fatal("不可更新遮蔽文件")
	}
}

func TestCronJobActiveReferences(t *testing.T) {
	raw := resourceServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"items":[{"metadata":{"name":"backup","namespace":"dev"},"spec":{"schedule":"0 0 * * *"},"status":{"active":[{"name":"backup-1","namespace":"dev"}]}}]}`))
	})
	if result, err := ListResources(raw, "dev", "cronjobs"); err != nil || !strings.Contains(result, "0 0 * * *") {
		t.Fatal(result, err)
	}
}
