package hostvault

import (
	"context"
	"testing"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"
)

func TestGroupHierarchyNestingAndCascadeDelete(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	// 建立 AWS（頂層）→ Prod（子）→ Canary（孫）三層目錄
	aws, err := svc.SaveGroup(ctx, dto.HostGroup{Name: "AWS"})
	if err != nil {
		t.Fatalf("建立 AWS 失敗：%v", err)
	}
	prod, err := svc.SaveGroup(ctx, dto.HostGroup{Name: "Prod", ParentID: aws.ID})
	if err != nil {
		t.Fatalf("建立 Prod 失敗：%v", err)
	}
	canary, err := svc.SaveGroup(ctx, dto.HostGroup{Name: "Canary", ParentID: prod.ID})
	if err != nil {
		t.Fatalf("建立 Canary 失敗：%v", err)
	}
	if prod.ParentID != aws.ID || canary.ParentID != prod.ID {
		t.Fatalf("parentId 未正確保存：prod=%q canary=%q", prod.ParentID, canary.ParentID)
	}

	// 在 Prod 底下放一台主機
	host, _, err := svc.SaveHost(ctx, dto.SaveHostRequest{
		Host: dto.HostProfile{
			Label:   "db-01",
			GroupID: prod.ID,
			Config: dto.PersistedHostConfig{
				Host:     "10.0.0.9",
				Port:     22,
				Username: "ubuntu",
				AuthMode: constants.AuthModePassword,
			},
		},
	})
	if err != nil {
		t.Fatalf("建立主機失敗：%v", err)
	}

	// 防呆：不可把 AWS 移動到其子孫 Canary 底下（會形成循環）
	if _, err := svc.SaveGroup(ctx, dto.HostGroup{ID: aws.ID, Name: "AWS", ParentID: canary.ID}); err == nil {
		t.Fatalf("將目錄移到子孫底下應被拒絕，但成功了")
	}

	// 防呆：父目錄不可為自己
	if _, err := svc.SaveGroup(ctx, dto.HostGroup{ID: prod.ID, Name: "Prod", ParentID: prod.ID}); err == nil {
		t.Fatalf("父目錄設為自己應被拒絕，但成功了")
	}

	// 刪除頂層 AWS：連 Prod / Canary 一併刪除，其下主機轉為未分組
	if err := svc.DeleteGroup(ctx, aws.ID); err != nil {
		t.Fatalf("刪除 AWS 失敗：%v", err)
	}

	groups, err := svc.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups 失敗：%v", err)
	}
	if len(groups) != 0 {
		t.Fatalf("子樹未被完整刪除，剩餘：%d 個群組", len(groups))
	}

	got, err := svc.GetHost(ctx, host.ID)
	if err != nil {
		t.Fatalf("主機不應被刪除，但取不到：%v", err)
	}
	if got.GroupID != "" {
		t.Fatalf("主機應轉為未分組，實際 groupId=%q", got.GroupID)
	}
}
