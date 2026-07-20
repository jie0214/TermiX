package kubernetes

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/dto"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"
)

const testConfig = `apiVersion: v1
kind: Config
clusters:
  - name: dev-cluster
    cluster:
      server: https://dev.example.test
      certificate-authority: /tmp/dev-ca.crt
contexts:
  - name: dev
    context:
      cluster: dev-cluster
      user: oidc-user
      namespace: applications
users:
  - name: oidc-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: custom-login
current-context: dev
`

func TestReadProfiles(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	items, err := readProfiles(path)
	if err != nil {
		t.Fatalf("readProfiles() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	item := items[0]
	if item.ContextName != "dev" || item.ClusterName != "dev-cluster" || !item.IsCurrent {
		t.Fatalf("item = %+v", item)
	}
	if item.UserName != "oidc-user" || item.Namespace != "applications" {
		t.Fatalf("Context 欄位解析錯誤：%+v", item)
	}
}

func TestNormalizePath展開WindowsUserProfile路徑(t *testing.T) {
	t.Setenv("USERPROFILE", t.TempDir())
	path, err := normalizePath("%USERPROFILE%/.kube/config")
	if err != nil {
		t.Fatalf("normalizePath() error = %v", err)
	}
	if want := filepath.Join(os.Getenv("USERPROFILE"), ".kube", "config"); path != want {
		t.Fatalf("normalizePath() = %q, want %q", path, want)
	}
}

func TestSavePreservesUserAndCreatesBackup(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(t)
	item, err := svc.Save(context.Background(), dto.KubernetesClusterProfile{
		DisplayName: "正式環境", KubeconfigPath: path, ContextName: "prod",
		ClusterName: "prod-cluster", Server: "https://prod.example.test",
		UserName: "oidc-user", Namespace: "default",
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if item.ID == "" || item.Source != "managed" {
		t.Fatalf("Save() = %+v", item)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, expected := range []string{"custom-login", "prod-cluster", "https://prod.example.test"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("kubeconfig 缺少 %q：\n%s", expected, content)
		}
	}
	if _, err := os.Stat(path + ".termix.bak"); err != nil {
		t.Fatalf("備份檔不存在：%v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode = %o, want 600", info.Mode().Perm())
	}
	backupInfo, err := os.Stat(path + ".termix.bak")
	if err != nil {
		t.Fatal(err)
	}
	if backupInfo.Mode().Perm() != 0600 {
		t.Fatalf("備份 mode = %o, want 600", backupInfo.Mode().Perm())
	}
	listed, err := svc.List(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, got := range listed {
		if got.ID == item.ID && got.DisplayName == "正式環境" {
			found = true
		}
	}
	if !found {
		t.Fatalf("List() 未合併 managed 中繼資料：%+v", listed)
	}
}

func TestSwitchContext(t *testing.T) {
	path := writeTestConfig(t, strings.Replace(testConfig, "users:", `  - name: prod
    context:
      cluster: dev-cluster
      user: oidc-user
users:`, 1))
	svc := newTestService(t)
	if err := svc.SwitchContext(path, "prod"); err != nil {
		t.Fatalf("SwitchContext() error = %v", err)
	}
	items, err := readProfiles(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ContextName == "prod" && !item.IsCurrent {
			t.Fatal("prod Context 未設為 current-context")
		}
	}
	if err := svc.SwitchContext(path, "missing"); err == nil {
		t.Fatal("不存在的 Context 應回傳錯誤")
	}
}

func TestMalformedConfig(t *testing.T) {
	path := writeTestConfig(t, "contexts: [")
	if _, err := readProfiles(path); err == nil || !strings.Contains(err.Error(), "解析 kubeconfig YAML 失敗") {
		t.Fatalf("readProfiles() error = %v", err)
	}
}

func TestSaveRejectsUnknownUser(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	_, err := newTestService(t).Save(context.Background(), dto.KubernetesClusterProfile{
		KubeconfigPath: path, ContextName: "prod", ClusterName: "prod",
		Server: "https://prod.example.test", UserName: "missing",
	})
	if err == nil || !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("Save() error = %v", err)
	}
}

func TestConnectKubernetesCluster(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	svc := newTestService(t)
	session, err := svc.Connect(dto.KubernetesConnectRequest{
		ClusterID: "cluster-record-1", DisplayName: "開發叢集", ContextName: "dev",
		ClusterName: "錯誤名稱", Server: "https://wrong.example.test",
		KubeconfigPath: path, Namespace: "wrong-namespace",
	})
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if session.SessionID != "kubernetes-tab" || session.ClusterID != "cluster-record-1" {
		t.Fatalf("Connect() = %+v", session)
	}
	if session.ClusterName != "dev-cluster" || session.Server != "https://dev.example.test" || session.Namespace != "applications" {
		t.Fatalf("Connect() 未採用 kubeconfig 真實資料：%+v", session)
	}
	if session.ConnectedAt == "" {
		t.Fatal("Connect() 未設定 connectedAt")
	}
	active := svc.GetActiveSession()
	if active == nil || *active != session {
		t.Fatalf("GetActiveSession() = %+v, want %+v", active, session)
	}
}

// context 未指定 namespace 時，Connect 回退採用 request.Namespace（由 binding 填入設定的全域預設）。
func TestConnectFallsBackToRequestNamespace(t *testing.T) {
	config := strings.Replace(testConfig, "users:", `  - name: prod
    context:
      cluster: dev-cluster
      user: oidc-user
users:`, 1)
	path := writeTestConfig(t, config)

	session, err := newTestService(t).Connect(dto.KubernetesConnectRequest{ContextName: "prod", KubeconfigPath: path, Namespace: "team-x"})
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if session.Namespace != "team-x" {
		t.Fatalf("context 無 namespace 時應回退 request.Namespace，got %q", session.Namespace)
	}

	empty, err := newTestService(t).Connect(dto.KubernetesConnectRequest{ContextName: "prod", KubeconfigPath: path})
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if empty.Namespace != "" {
		t.Fatalf("context 與 request 皆無 namespace 時應為空，got %q", empty.Namespace)
	}
}

func TestConnectSyncsCurrentContext(t *testing.T) {
	config := strings.Replace(testConfig, "users:", `  - name: prod
    context:
      cluster: dev-cluster
      user: oidc-user
users:`, 1)
	path := writeTestConfig(t, config)
	if _, err := newTestService(t).Connect(dto.KubernetesConnectRequest{ContextName: "prod", KubeconfigPath: path}); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	root, _, err := loadConfig(path, false)
	if err != nil {
		t.Fatal(err)
	}
	// Connect 連線成功後應把 kubeconfig current-context 同步切到該 context，
	// 讓外部 kubectl/kubectx 與「目前使用中」徽章一致（原本預設為 dev）。
	if got := scalarValue(mappingValue(root, "current-context")); got != "prod" {
		t.Fatalf("current-context = %q, want prod", got)
	}
}

func TestConnectReplacesSingleSession(t *testing.T) {
	config := strings.Replace(testConfig, "users:", `  - name: prod
    context:
      cluster: dev-cluster
      user: oidc-user
      namespace: production
users:`, 1)
	path := writeTestConfig(t, config)
	svc := newTestService(t)
	first, err := svc.Connect(dto.KubernetesConnectRequest{ContextName: "dev", KubeconfigPath: path})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Connect(dto.KubernetesConnectRequest{ContextName: "prod", KubeconfigPath: path})
	if err != nil {
		t.Fatal(err)
	}
	if first.SessionID != second.SessionID || second.SessionID != "kubernetes-tab" {
		t.Fatalf("Session ID 未維持唯一：first=%+v second=%+v", first, second)
	}
	active := svc.GetActiveSession()
	if active == nil || active.ContextName != "prod" || active.Namespace != "production" {
		t.Fatalf("活動 Session 未被取代：%+v", active)
	}
}

func TestConnectFailurePreservesActiveSession(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	svc := newTestService(t)
	first, err := svc.Connect(dto.KubernetesConnectRequest{ContextName: "dev", KubeconfigPath: path})
	if err != nil {
		t.Fatal(err)
	}
	svc.clientFactory = func(dto.KubernetesSession) (*clusterClients, error) {
		return nil, errors.New("模擬 API Server 連線失敗")
	}
	if _, err := svc.Connect(dto.KubernetesConnectRequest{ContextName: "dev", KubeconfigPath: path}); err == nil {
		t.Fatal("連線失敗時應回傳錯誤")
	}
	active := svc.GetActiveSession()
	if active == nil || *active != first {
		t.Fatalf("連線失敗後活動 Session 被修改：got=%+v want=%+v", active, first)
	}
}

func TestConnectionErrorDoesNotExposeUnderlyingDetails(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "Unauthorized", err: apierrors.NewUnauthorized("secret-token"), want: "認證已失效"},
		{name: "Forbidden", err: apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "", errors.New("secret-token")), want: "沒有存取權限"},
		{name: "Other", err: errors.New("exec plugin printed secret-token"), want: "請檢查網路"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := connectionError(test.err).Error()
			if !strings.Contains(got, test.want) || strings.Contains(got, "secret-token") {
				t.Fatalf("connectionError() = %q", got)
			}
		})
	}
}

func TestConnectRejectsUnknownContext(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	_, err := newTestService(t).Connect(dto.KubernetesConnectRequest{ContextName: "missing", KubeconfigPath: path})
	if err == nil || !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("Connect() error = %v", err)
	}
}

func TestDisconnectKubernetesCluster(t *testing.T) {
	path := writeTestConfig(t, testConfig)
	svc := newTestService(t)
	if _, err := svc.Connect(dto.KubernetesConnectRequest{ContextName: "dev", KubeconfigPath: path}); err != nil {
		t.Fatal(err)
	}
	svc.Disconnect()
	if active := svc.GetActiveSession(); active != nil {
		t.Fatalf("Disconnect() 後仍有活動 Session：%+v", active)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	database, err := storage.OpenDatabase(filepath.Join(t.TempDir(), "termix.db"))
	if err != nil {
		t.Fatalf("OpenDatabase() error = %v", err)
	}
	t.Cleanup(func() { _ = database.DB.Close() })
	service := NewService(storage.NewRepository(database))
	service.clientFactory = func(dto.KubernetesSession) (*clusterClients, error) {
		return &clusterClients{
			core:          kubernetesfake.NewSimpleClientset(),
			metrics:       metricsfake.NewSimpleClientset(),
			serverVersion: "v1.35.0",
		}, nil
	}
	return service
}

func writeTestConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
