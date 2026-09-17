package app

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/backend/terminal"
	"github.com/jie0214/TermiX/shared/dto"
)

func TestStatusBarSnapshotEmpty(t *testing.T) {
	data, err := json.Marshal(buildStatusBarSnapshot(nil, nil, nil))
	if err != nil || string(data) != `{"connections":[],"cluster":[],"forwards":[]}` {
		t.Fatalf("原生選單的空集合必須是陣列：%s，%v", data, err)
	}
}

func TestStatusBarSnapshotTargets(t *testing.T) {
	snapshot := buildStatusBarSnapshot(
		[]terminal.ConnectionStatus{{SessionKey: "ssh-1", Alias: "正式環境主機", Host: "::1", Port: 2222, Username: "deploy"}},
		&dto.KubernetesSession{DisplayName: "正式環境", ContextName: "prod", Server: "https://cluster.example"},
		[]dto.KubernetesPodPortForward{
			{ID: "pod-forward", Address: "127.0.0.1", LocalPort: 8080, Namespace: "default", PodName: "api-0", RemotePort: 80},
			{ID: "service-forward", Address: "::1", LocalPort: 9090, Namespace: "ops", PodName: "metrics-0", ServiceName: "metrics", RemotePort: 90},
		},
	)
	if snapshot.Connections[0].Title != "正式環境主機 · ::1" || len(snapshot.Cluster) != 1 || snapshot.Cluster[0] != "正式環境 · prod" {
		t.Fatalf("連線資訊不正確：%+v", snapshot)
	}
	if len(snapshot.Forwards) != 2 || !strings.Contains(snapshot.Forwards[0].Title, "127.0.0.1:8080 → default/Pod/api-0:80") || !strings.Contains(snapshot.Forwards[1].Title, "[::1]:9090 → ops/Service/metrics:90") {
		t.Fatalf("轉發目標不正確：%+v", snapshot.Forwards)
	}
}

func TestStatusBarPreservesDistinctSessionIDs(t *testing.T) {
	snapshot := buildStatusBarSnapshot([]terminal.ConnectionStatus{{SessionKey: "ssh-a", Host: "host", Port: 22}, {SessionKey: "ssh-b", Host: "host", Port: 22}}, nil, []dto.KubernetesPodPortForward{{ID: "forward-a"}, {ID: "forward-b"}})
	if snapshot.Connections[0].ID != "ssh-a" || snapshot.Connections[1].ID != "ssh-b" || snapshot.Forwards[0].ID != "forward-a" || snapshot.Forwards[1].ID != "forward-b" {
		t.Fatalf("同主機連線與轉發必須保留個別操作識別碼：%+v", snapshot)
	}
}
