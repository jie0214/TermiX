package hostvault

import (
	"context"
	"encoding/json"
	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/shared/dto"
	"strings"
	"testing"
)

func TestMobileSettingsExportWhitelist(t *testing.T) {
	s := newTestService(t, secrets.NewMemoryStore())
	ctx := context.Background()
	_, _, err := s.SaveHost(ctx, dto.SaveHostRequest{Host: dto.HostProfile{ID: "desktop-1", Label: "Lab", Config: dto.PersistedHostConfig{Host: "lab.example", Port: 22, Username: "admin", AuthMode: "password", PrivateKeyPath: "/secret/key", StartupCommandText: "secret-command", CustomQueryScript: "secret-script"}}, Secrets: dto.HostSecretsInput{SSHPassword: dto.SecretValueInput{Value: "test-secret", HasValue: true}}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := s.ExportMobileSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"secret", "authMode", "privateKey", `"settings":`, "command", "SecretRefs"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("匯出包含禁止欄位：%s", forbidden)
		}
	}
	var document struct {
		Version  string           `json:"version"`
		SourceID string           `json:"sourceId"`
		Hosts    []map[string]any `json:"hosts"`
	}
	if err = json.Unmarshal([]byte(raw), &document); err != nil {
		t.Fatal(err)
	}
	if document.Version != "termix.mobile-settings.v2" || document.SourceID == "" || len(document.Hosts) != 1 || len(document.Hosts[0]) != 6 || document.Hosts[0]["name"] != "Lab" {
		t.Fatalf("格式錯誤：%s", raw)
	}
	again, err := s.ExportMobileSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if raw != again {
		t.Fatal("未變更的設定必須具有穩定來源與內容")
	}
}

func TestMobileExportRejectsIncompatibleHosts(t *testing.T) {
	s := newTestService(t, secrets.NewMemoryStore())
	_, _, err := s.SaveHost(context.Background(), dto.SaveHostRequest{Host: dto.HostProfile{ID: "invalid-name", Label: strings.Repeat("字", 81), Config: dto.PersistedHostConfig{Host: "lab.example", Port: 22, Username: "admin", AuthMode: "password"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ExportMobileSettings(context.Background()); err == nil {
		t.Fatal("不相容主機不可靜默略過")
	}
}

func TestMobileExportFolderHierarchy(t *testing.T) {
	s := newTestService(t, secrets.NewMemoryStore())
	ctx := context.Background()
	parent, err := s.SaveGroup(ctx, dto.HostGroup{Name: "工作"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.SaveGroup(ctx, dto.HostGroup{Name: "正式環境", ParentID: parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = s.SaveHost(ctx, dto.SaveHostRequest{Host: dto.HostProfile{ID: "nested", Label: "Lab", GroupID: child.ID, Config: dto.PersistedHostConfig{Host: "lab.example", Port: 22, Username: "admin", AuthMode: "password"}}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := s.ExportMobileSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Hosts []struct {
			FolderPath []string `json:"folderPath"`
		} `json:"hosts"`
	}
	if err = json.Unmarshal([]byte(raw), &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Hosts) != 1 || strings.Join(document.Hosts[0].FolderPath, "/") != "工作/正式環境" {
		t.Fatal("匯出遺失資料夾層級")
	}
}
