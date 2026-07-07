package hostvault

import (
	"context"
	"errors"
	"testing"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"

	compute "google.golang.org/api/compute/v1"
)

type mockGCPComputeClient struct {
	ListInstancesFunc func(ctx context.Context, projectID string) ([]*compute.Instance, error)
}

func (m *mockGCPComputeClient) ListInstances(ctx context.Context, projectID string) ([]*compute.Instance, error) {
	return m.ListInstancesFunc(ctx, projectID)
}

// gcpInstance 建立一個帶有公有/私有 IP 的 Compute Engine 實例。
func gcpInstance(id uint64, name, privateIP, publicIP string) *compute.Instance {
	ni := &compute.NetworkInterface{NetworkIP: privateIP}
	if publicIP != "" {
		ni.AccessConfigs = []*compute.AccessConfig{{NatIP: publicIP}}
	}
	return &compute.Instance{
		Id:                id,
		Name:              name,
		NetworkInterfaces: []*compute.NetworkInterface{ni},
	}
}

func TestSyncGCP(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	groupID := "gcp-test-group"
	if _, err := svc.SaveGroup(ctx, dto.HostGroup{ID: groupID, Name: "GCP Integration Group"}); err != nil {
		t.Fatalf("SaveGroup 失敗：%v", err)
	}

	saJSON := `{"type":"service_account","project_id":"demo"}`
	integration, err := svc.SaveGCPIntegration(ctx, dto.SaveGCPIntegrationRequest{
		Integration: dto.GCPIntegration{
			GroupID:         groupID,
			Name:            "Production GCP Project",
			ProjectID:       "demo-project",
			IPAddressType:   "public",
			DefaultPort:     22,
			DefaultUsername: "ubuntu",
			AuthMode:        constants.AuthModeKey,
		},
		Secrets: dto.GCPIntegrationSecretsInput{
			ServiceAccountJSON: dto.SecretValueInput{Value: saJSON, HasValue: true},
		},
	})
	if err != nil {
		t.Fatalf("SaveGCPIntegration 失敗：%v", err)
	}
	if integration.Name != "Production GCP Project" {
		t.Fatalf("GCPIntegration.Name = %q，預期 Production GCP Project", integration.Name)
	}

	storedSecret, err := secretStore.GetSecret(ctx, integration.ServiceAccountJSONRef)
	if err != nil {
		t.Fatalf("無法從 Secret 存放區取得金鑰：%v", err)
	}
	if storedSecret != saJSON {
		t.Errorf("取得的金鑰為 %q，與期望不符", storedSecret)
	}

	var instances []*compute.Instance
	svc.gcpComputeClientBuilder = func(ctx context.Context, serviceAccountJSON string) (gcpComputeInstancesAPI, error) {
		return &mockGCPComputeClient{
			ListInstancesFunc: func(ctx context.Context, projectID string) ([]*compute.Instance, error) {
				return instances, nil
			},
		}, nil
	}

	// 情境一：新增
	instances = []*compute.Instance{gcpInstance(123, "gce-web", "10.0.1.2", "35.1.1.2")}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 第一次同步失敗：%v", err)
	}

	hosts, err := svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}
	var found bool
	var hostID string
	for _, h := range hosts {
		if h.GCPInstanceID == "gcp/compute/123" {
			found = true
			hostID = h.ID
			if h.Label != "gce-web" {
				t.Errorf("GCP Host Label 錯誤，為：%q", h.Label)
			}
			if h.Config.Host != "35.1.1.2" {
				t.Errorf("GCP Host IP 錯誤，為：%q", h.Config.Host)
			}
		}
	}
	if !found {
		t.Fatalf("未能同步新增 Compute Engine 實例")
	}

	// 情境二：更新 IP 與名稱
	instances = []*compute.Instance{gcpInstance(123, "gce-web-updated", "10.0.1.2", "35.1.1.20")}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 第二次同步失敗：%v", err)
	}
	hosts, _ = svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.GCPInstanceID == "gcp/compute/123" {
			if h.Label != "gce-web-updated" {
				t.Errorf("GCP Host Label 更新失敗，為：%q", h.Label)
			}
			if h.Config.Host != "35.1.1.20" {
				t.Errorf("GCP Host IP 更新失敗，為：%q", h.Config.Host)
			}
		}
	}

	// 情境三：刪除
	instances = []*compute.Instance{}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 第三次同步失敗：%v", err)
	}
	hosts, _ = svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.ID == hostID {
			t.Errorf("同步刪除失敗，Host 依然存在：ID=%s", h.ID)
		}
	}

	// 情境四：手動刪除防復活 + 自我清理 + 刪除整合清理排除表
	instances = []*compute.Instance{gcpInstance(999, "gce-vm", "10.0.9.9", "35.9.9.9")}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 情境四第一次同步失敗：%v", err)
	}
	hosts, _ = svc.ListHosts(ctx)
	var target dto.HostProfile
	for _, h := range hosts {
		if h.GCPInstanceID == "gcp/compute/999" {
			target = h
		}
	}
	if target.ID == "" {
		t.Fatalf("未成功同步建立測試 GCP 主機")
	}

	if err := svc.DeleteHost(ctx, target.ID); err != nil {
		t.Fatalf("DeleteHost 失敗：%v", err)
	}
	deletedList, err := svc.repo.ListDeletedGCPInstances(ctx, groupID)
	if err != nil {
		t.Fatalf("ListDeletedGCPInstances 失敗：%v", err)
	}
	foundExcl := false
	for _, id := range deletedList {
		if id == "gcp/compute/999" {
			foundExcl = true
		}
	}
	if !foundExcl {
		t.Errorf("被刪除之 GCP 實例 ID 未記錄至排除表中")
	}

	// AWS 端仍回傳該實例，再同步不應復活
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 情境四第二次同步失敗：%v", err)
	}
	hosts, _ = svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.GCPInstanceID == "gcp/compute/999" {
			t.Errorf("被手動刪除的 GCP 主機在同步後死而復生了")
		}
	}

	// 實例在 GCP 端已刪除 → 排除表自我清理
	instances = []*compute.Instance{}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 情境四第三次同步失敗：%v", err)
	}
	deletedList, _ = svc.repo.ListDeletedGCPInstances(ctx, groupID)
	if len(deletedList) != 0 {
		t.Errorf("自我清理機制未發揮作用，排除表中仍有紀錄：%v", deletedList)
	}

	// 加回並刪除以寫入排除表，測試刪除整合時清理
	instances = []*compute.Instance{gcpInstance(999, "gce-vm", "10.0.9.9", "35.9.9.9")}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 恢復同步失敗：%v", err)
	}
	hosts, _ = svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.GCPInstanceID == "gcp/compute/999" {
			_ = svc.DeleteHost(ctx, h.ID)
		}
	}
	deletedList, _ = svc.repo.ListDeletedGCPInstances(ctx, groupID)
	if len(deletedList) == 0 {
		t.Fatalf("排除表應有新記錄，但為空")
	}
	if err := svc.DeleteGCPIntegration(ctx, groupID); err != nil {
		t.Fatalf("DeleteGCPIntegration 失敗：%v", err)
	}
	deletedList, _ = svc.repo.ListDeletedGCPInstances(ctx, groupID)
	if len(deletedList) != 0 {
		t.Errorf("刪除 GCP 整合後，排除表未被清理：%v", deletedList)
	}
}

func TestSyncGCPPrivateIP(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	groupID := "gcp-private-group"
	_, _ = svc.SaveGroup(ctx, dto.HostGroup{ID: groupID, Name: "GCP Private"})
	if _, err := svc.SaveGCPIntegration(ctx, dto.SaveGCPIntegrationRequest{
		Integration: dto.GCPIntegration{
			GroupID:         groupID,
			ProjectID:       "demo-project",
			IPAddressType:   "private",
			DefaultPort:     22,
			DefaultUsername: "ubuntu",
			AuthMode:        constants.AuthModeKey,
		},
		Secrets: dto.GCPIntegrationSecretsInput{
			ServiceAccountJSON: dto.SecretValueInput{Value: "{}", HasValue: true},
		},
	}); err != nil {
		t.Fatalf("SaveGCPIntegration 失敗：%v", err)
	}

	svc.gcpComputeClientBuilder = func(ctx context.Context, serviceAccountJSON string) (gcpComputeInstancesAPI, error) {
		return &mockGCPComputeClient{
			ListInstancesFunc: func(ctx context.Context, projectID string) ([]*compute.Instance, error) {
				return []*compute.Instance{gcpInstance(7, "gce-internal", "10.0.7.7", "35.7.7.7")}, nil
			},
		}, nil
	}
	if err := svc.SyncGCP(ctx, groupID); err != nil {
		t.Fatalf("SyncGCP 失敗：%v", err)
	}
	hosts, _ := svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.GCPInstanceID == "gcp/compute/7" && h.Config.Host != "10.0.7.7" {
			t.Errorf("private IP 模式下應採私有 IP，實際為：%q", h.Config.Host)
		}
	}
}

func TestSaveGCPIntegrationMoveGroup(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	oldGroupID := "gcp-old-group"
	newGroupID := "gcp-new-group"
	_, _ = svc.SaveGroup(ctx, dto.HostGroup{ID: oldGroupID, Name: "Old Group"})
	_, _ = svc.SaveGroup(ctx, dto.HostGroup{ID: newGroupID, Name: "New Group"})

	created, err := svc.SaveGCPIntegration(ctx, dto.SaveGCPIntegrationRequest{
		Integration: dto.GCPIntegration{
			GroupID:         oldGroupID,
			Name:            "GCP Prod",
			ProjectID:       "demo-project",
			IPAddressType:   "public",
			DefaultPort:     22,
			DefaultUsername: "ubuntu",
			AuthMode:        constants.AuthModePassword,
		},
		Secrets: dto.GCPIntegrationSecretsInput{
			ServiceAccountJSON: dto.SecretValueInput{Value: "old-sa-json", HasValue: true},
		},
	})
	if err != nil {
		t.Fatalf("建立 GCP Integration 失敗：%v", err)
	}

	savedHost, _, err := svc.SaveHost(ctx, dto.SaveHostRequest{
		Host: dto.HostProfile{
			ID:            "h_gcp_sync_old",
			Label:         "GCE Old",
			GroupID:       oldGroupID,
			GCPInstanceID: "gcp/compute/1",
			Config: dto.PersistedHostConfig{
				Host:     "10.0.0.1",
				Port:     22,
				Username: "ubuntu",
				AuthMode: constants.AuthModePassword,
			},
		},
	})
	if err != nil {
		t.Fatalf("建立舊群組 GCP Host 失敗：%v", err)
	}

	moved, err := svc.SaveGCPIntegration(ctx, dto.SaveGCPIntegrationRequest{
		Integration: dto.GCPIntegration{
			GroupID:               newGroupID,
			Name:                  "GCP Prod",
			ProjectID:             "demo-project",
			IPAddressType:         "public",
			DefaultPort:           22,
			DefaultUsername:       "ubuntu",
			AuthMode:              constants.AuthModePassword,
			ServiceAccountJSONRef: created.ServiceAccountJSONRef,
		},
		PreviousGroupID: oldGroupID,
	})
	if err != nil {
		t.Fatalf("移轉 GCP Integration 失敗：%v", err)
	}
	if moved.GroupID != newGroupID {
		t.Fatalf("移轉後 GroupID = %q，預期 %q", moved.GroupID, newGroupID)
	}
	if _, err := svc.GetGCPIntegration(ctx, oldGroupID); err == nil {
		t.Fatalf("舊群組的 GCP Integration 應已刪除")
	}
	newSecret, err := secretStore.GetSecret(ctx, moved.ServiceAccountJSONRef)
	if err != nil {
		t.Fatalf("取得新群組 secret 失敗：%v", err)
	}
	if newSecret != "old-sa-json" {
		t.Fatalf("新群組 secret = %q，預期 old-sa-json", newSecret)
	}
	if _, err := secretStore.GetSecret(ctx, created.ServiceAccountJSONRef); !errors.Is(err, secrets.ErrSecretNotFound) {
		t.Fatalf("舊群組 secret 應已被清除，實際 err=%v", err)
	}

	hosts, _ := svc.ListHosts(ctx)
	foundHost := false
	for _, host := range hosts {
		if host.ID == savedHost.ID {
			foundHost = true
			if host.GroupID != newGroupID {
				t.Fatalf("GCP Host 群組未隨 Integration 移轉，實際 %q", host.GroupID)
			}
		}
	}
	if !foundHost {
		t.Fatalf("找不到移轉後的 GCP Host：%s", savedHost.ID)
	}
}
