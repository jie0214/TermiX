package mobilecloud

import (
	"context"
	"encoding/json"
	"github.com/jie0214/TermiX/shared/dto"
	"testing"
)

type testSettings struct{ settings dto.AppSettings }

func (s *testSettings) GetSettings(context.Context) (dto.AppSettings, error) { return s.settings, nil }
func (s *testSettings) SaveSettings(_ context.Context, p dto.AppSettings) (dto.AppSettings, error) {
	for k, v := range p {
		s.settings[k] = v
	}
	return s.settings, nil
}
func (s *testSettings) ExportMobileSettings(context.Context) (string, error) {
	return `{"version":"termix.mobile-settings.v1","sourceId":"desktop-1","hosts":[]}`, nil
}
func TestCloudRequiresOptInAndReportsRealResult(t *testing.T) {
	storage := &testSettings{dto.AppSettings{}}
	sent := 0
	service := NewService(storage, func(raw string) string {
		sent++
		var document map[string]any
		if json.Unmarshal([]byte(raw), &document) != nil {
			t.Fatal("無效設定")
		}
		return "no_account"
	})
	ctx := context.Background()
	if err := service.Load(ctx); err != nil {
		t.Fatal(err)
	}
	service.Sync(ctx)
	if sent != 0 {
		t.Fatal("未啟用卻上傳")
	}
	if err := service.SetEnabled(ctx, true); err != nil {
		t.Fatal(err)
	}
	service.Sync(ctx)
	if sent != 1 || service.Status().Error != "no_account" || service.Status().LastSuccess != "" {
		t.Fatal("失敗不得呈現成功")
	}
	if err := service.SetEnabled(ctx, false); err != nil {
		t.Fatal(err)
	}
	service.Sync(ctx)
	if sent != 1 {
		t.Fatal("停用仍上傳")
	}
	restored := NewService(storage, func(string) string { return "ok" })
	if err := restored.Load(ctx); err != nil {
		t.Fatal(err)
	}
	if restored.Status().Enabled {
		t.Fatal("停用設定未保存")
	}
}

func TestUnavailableBuildDoesNotRestoreOrEnableCloud(t *testing.T) {
	for _, capability := range []string{"unsupported", "not_configured"} {
		t.Run(capability, func(t *testing.T) {
			storage := &testSettings{dto.AppSettings{"mobileCloudEnabled": json.RawMessage("true")}}
			service := NewService(storage, func(string) string { t.Fatal("不可呼叫雲端"); return "ok" }, func() string { return capability })
			ctx := context.Background()
			if err := service.Load(ctx); err != nil {
				t.Fatal(err)
			}
			if service.Status().Enabled || service.Status().Capability != capability {
				t.Fatal("能力或模式錯誤")
			}
			if service.SetEnabled(ctx, true) == nil {
				t.Fatal("不可啟用不支援的同步")
			}
			service.Sync(ctx)
			if string(storage.settings["mobileCloudEnabled"]) != "true" {
				t.Fatal("不應覆寫原始偏好")
			}
		})
	}
}
