package hostvault

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/dto"

	compute "google.golang.org/api/compute/v1"
	"google.golang.org/api/option"
)

// gcpComputeInstancesAPI 抽象出「列出某專案下所有 Compute Engine 實例」的能力，
// 以便在測試中注入假的 client（對應 AWS 的 ec2ClientBuilder / lightsailClientBuilder）。
type gcpComputeInstancesAPI interface {
	ListInstances(ctx context.Context, projectID string) ([]*compute.Instance, error)
}

type gcpComputeClient struct {
	svc *compute.Service
}

func (c *gcpComputeClient) ListInstances(ctx context.Context, projectID string) ([]*compute.Instance, error) {
	var instances []*compute.Instance
	call := c.svc.Instances.AggregatedList(projectID)
	err := call.Pages(ctx, func(page *compute.InstanceAggregatedList) error {
		for _, scoped := range page.Items {
			instances = append(instances, scoped.Instances...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return instances, nil
}

func newGCPComputeClient(ctx context.Context, serviceAccountJSON string) (gcpComputeInstancesAPI, error) {
	svc, err := compute.NewService(ctx, option.WithCredentialsJSON([]byte(serviceAccountJSON)))
	if err != nil {
		return nil, err
	}
	return &gcpComputeClient{svc: svc}, nil
}

func (s *Service) ListGCPIntegrations(ctx context.Context) ([]dto.GCPIntegration, error) {
	return s.repo.ListGCPIntegrations(ctx)
}

func (s *Service) GetGCPIntegration(ctx context.Context, groupID string) (dto.GCPIntegration, error) {
	return s.repo.GetGCPIntegration(ctx, groupID)
}

func (s *Service) SaveGCPIntegration(ctx context.Context, request dto.SaveGCPIntegrationRequest) (dto.GCPIntegration, error) {
	integration := request.Integration
	previousGroupID := strings.TrimSpace(request.PreviousGroupID)
	integration.GroupID = strings.TrimSpace(integration.GroupID)
	integration.Name = strings.TrimSpace(integration.Name)
	if integration.GroupID == "" {
		return dto.GCPIntegration{}, errors.New("group_id 不可空白")
	}
	if integration.Name == "" {
		integration.Name = integration.GroupID
	}

	// 檢查 group 是否存在
	exists, err := s.repo.GroupExists(ctx, integration.GroupID)
	if err != nil {
		return dto.GCPIntegration{}, err
	}
	if !exists {
		return dto.GCPIntegration{}, fmt.Errorf("host group 不存在：%s", integration.GroupID)
	}

	ref := fmt.Sprintf("gcp/%s/service-account-json", integration.GroupID)
	integration.ServiceAccountJSONRef = ref
	defaultPwdRef := fmt.Sprintf("gcp/%s/default-password", integration.GroupID)
	integration.DefaultPasswordRef = defaultPwdRef

	var previousIntegration dto.GCPIntegration
	var hasPreviousIntegration bool
	if previousGroupID != "" && previousGroupID != integration.GroupID {
		previousIntegration, err = s.repo.GetGCPIntegration(ctx, previousGroupID)
		if err != nil && !errors.Is(err, storage.ErrGCPIntegrationNotFound) {
			return dto.GCPIntegration{}, err
		}
		hasPreviousIntegration = err == nil
		if hasPreviousIntegration {
			if request.Integration.ServiceAccountJSONRef == "" {
				request.Integration.ServiceAccountJSONRef = previousIntegration.ServiceAccountJSONRef
			}
			if request.Integration.DefaultPasswordRef == "" {
				request.Integration.DefaultPasswordRef = previousIntegration.DefaultPasswordRef
			}
		}
	}

	// 處理 service account JSON secret
	if request.Secrets.ServiceAccountJSON.Clear {
		if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.GCPIntegration{}, fmt.Errorf("清除 GCP Service Account JSON 失敗：%w", err)
		}
	} else if request.Secrets.ServiceAccountJSON.HasValue {
		if err := s.secrets.SetSecret(ctx, ref, request.Secrets.ServiceAccountJSON.Value); err != nil {
			return dto.GCPIntegration{}, fmt.Errorf("儲存 GCP Service Account JSON 失敗：%w", err)
		}
	} else if request.Integration.ServiceAccountJSONRef != "" && request.Integration.ServiceAccountJSONRef != ref {
		// 說明是連結現有的 GCP 整合設定（從目標帳戶複製金鑰）
		targetSecretVal, err := s.secrets.GetSecret(ctx, request.Integration.ServiceAccountJSONRef)
		if err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.GCPIntegration{}, fmt.Errorf("從目標帳戶取得金鑰失敗：%w", err)
		}
		if err == nil {
			if err := s.secrets.SetSecret(ctx, ref, targetSecretVal); err != nil {
				return dto.GCPIntegration{}, fmt.Errorf("複製 GCP Service Account JSON 失敗：%w", err)
			}
		}
	}

	// 處理 default password secret
	if request.Secrets.DefaultPassword.Clear {
		if err := s.secrets.DeleteSecret(ctx, defaultPwdRef); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.GCPIntegration{}, fmt.Errorf("清除 GCP 預設密碼失敗：%w", err)
		}
	} else if request.Secrets.DefaultPassword.HasValue {
		if err := s.secrets.SetSecret(ctx, defaultPwdRef, request.Secrets.DefaultPassword.Value); err != nil {
			return dto.GCPIntegration{}, fmt.Errorf("儲存 GCP 預設密碼失敗：%w", err)
		}
	} else if request.Integration.DefaultPasswordRef != "" && request.Integration.DefaultPasswordRef != defaultPwdRef {
		// 說明是連結現有的 GCP 整合設定（從目標帳戶複製金鑰）
		targetSecretVal, err := s.secrets.GetSecret(ctx, request.Integration.DefaultPasswordRef)
		if err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.GCPIntegration{}, fmt.Errorf("從目標帳戶取得預設密碼失敗：%w", err)
		}
		if err == nil {
			if err := s.secrets.SetSecret(ctx, defaultPwdRef, targetSecretVal); err != nil {
				return dto.GCPIntegration{}, fmt.Errorf("複製 GCP 預設密碼失敗：%w", err)
			}
		}
	}

	// 載入既有的來保留 CreatedAt
	existing, err := s.repo.GetGCPIntegration(ctx, integration.GroupID)
	if err == nil {
		integration.CreatedAt = existing.CreatedAt
	} else {
		integration.CreatedAt = s.now().UTC().Format(time.RFC3339)
	}
	integration.UpdatedAt = s.now().UTC().Format(time.RFC3339)

	if err := s.repo.SaveGCPIntegration(ctx, integration); err != nil {
		return dto.GCPIntegration{}, err
	}

	if hasPreviousIntegration && previousGroupID != integration.GroupID {
		hosts, err := s.repo.ListHosts(ctx)
		if err != nil {
			return dto.GCPIntegration{}, err
		}
		for _, host := range hosts {
			if host.GroupID != previousGroupID || strings.TrimSpace(host.GCPInstanceID) == "" {
				continue
			}
			host.GroupID = integration.GroupID
			host.UpdatedAt = s.now().UTC().Format(time.RFC3339)
			if err := s.repo.SaveHost(ctx, host); err != nil {
				return dto.GCPIntegration{}, err
			}
		}
		if err := s.DeleteGCPIntegration(ctx, previousGroupID); err != nil {
			return dto.GCPIntegration{}, err
		}
	}

	return integration, nil
}

func (s *Service) DeleteGCPIntegration(ctx context.Context, groupID string) error {
	groupID = strings.TrimSpace(groupID)
	log.WithField("groupId", groupID).Info("刪除 GCP Integration 設定")
	if err := s.repo.DeleteGCPIntegration(ctx, groupID); err != nil {
		return err
	}
	if err := s.repo.CleanDeletedGCPInstancesByGroup(ctx, groupID); err != nil {
		log.WithError(err).Warnf("清除群組已刪除 GCP 實例排除記錄失敗：%s", groupID)
	}
	ref := fmt.Sprintf("gcp/%s/service-account-json", groupID)
	if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
		log.WithError(err).Warnf("刪除 GCP 整合設定時，清除 Secret 失敗：%s", ref)
	}
	pwdRef := fmt.Sprintf("gcp/%s/default-password", groupID)
	if err := s.secrets.DeleteSecret(ctx, pwdRef); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
		log.WithError(err).Warnf("刪除 GCP 整合設定時，清除預設密碼 Secret 失敗：%s", pwdRef)
	}
	return nil
}

type gcpInstanceInfo struct {
	ID    string
	Label string
	IP    string
}

func (s *Service) SyncGCP(ctx context.Context, groupID string) error {
	integration, err := s.repo.GetGCPIntegration(ctx, groupID)
	if err != nil {
		return err
	}

	// 取得 service account JSON
	serviceAccountJSON, err := s.secrets.GetSecret(ctx, integration.ServiceAccountJSONRef)
	if err != nil {
		return fmt.Errorf("無法取得 GCP Service Account JSON：%w", err)
	}

	var defaultPassword string
	if integration.AuthMode == "password" {
		if integration.DefaultPasswordRef != "" {
			var err error
			defaultPassword, err = s.secrets.GetSecret(ctx, integration.DefaultPasswordRef)
			if err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
				return fmt.Errorf("無法取得 GCP 預設密碼：%w", err)
			}
		}
	}

	// 建立 Compute Engine client
	var client gcpComputeInstancesAPI
	if s.gcpComputeClientBuilder != nil {
		client, err = s.gcpComputeClientBuilder(ctx, serviceAccountJSON)
	} else {
		client, err = newGCPComputeClient(ctx, serviceAccountJSON)
	}
	if err != nil {
		return fmt.Errorf("初始化 GCP Compute client 失敗：%w", err)
	}

	instances, err := client.ListInstances(ctx, integration.ProjectID)
	if err != nil {
		return fmt.Errorf("取得 Compute Engine 實例失敗：%w", err)
	}

	var allGCPInstances []gcpInstanceInfo
	for _, instance := range instances {
		if instance == nil {
			continue
		}
		name := instance.Name
		if name == "" {
			continue
		}

		var privateIP, publicIP string
		if len(instance.NetworkInterfaces) > 0 {
			ni := instance.NetworkInterfaces[0]
			privateIP = ni.NetworkIP
			if len(ni.AccessConfigs) > 0 {
				publicIP = ni.AccessConfigs[0].NatIP
			}
		}

		ip := ""
		if integration.IPAddressType == "private" {
			ip = privateIP
		} else {
			if publicIP != "" {
				ip = publicIP
			} else {
				ip = privateIP
			}
		}

		if ip == "" {
			continue
		}

		allGCPInstances = append(allGCPInstances, gcpInstanceInfo{
			ID:    fmt.Sprintf("gcp/compute/%d", instance.Id),
			Label: name,
			IP:    ip,
		})
	}

	// 取得目前 Group 下的所有 hosts
	allHosts, err := s.repo.ListHosts(ctx)
	if err != nil {
		return err
	}
	var groupHosts []dto.HostProfile
	for _, h := range allHosts {
		if h.GroupID == groupID && h.GCPInstanceID != "" {
			groupHosts = append(groupHosts, h)
		}
	}

	gcpMap := make(map[string]gcpInstanceInfo)
	for _, inst := range allGCPInstances {
		gcpMap[inst.ID] = inst
	}

	// 取得該群組下已被刪除的 GCP 排除名單，並執行自我清理
	deletedInstances, err := s.repo.ListDeletedGCPInstances(ctx, groupID)
	if err != nil {
		return err
	}
	deletedMap := make(map[string]bool)
	for _, id := range deletedInstances {
		if _, found := gcpMap[id]; found {
			deletedMap[id] = true
		} else {
			if err := s.repo.DeleteDeletedGCPInstance(ctx, id); err != nil {
				log.WithError(err).Warnf("清除無效的已刪除 GCP 實例記錄失敗：%s", id)
			}
		}
	}

	dbMap := make(map[string]dto.HostProfile)
	for _, h := range groupHosts {
		dbMap[h.GCPInstanceID] = h
	}

	// 同步：新增或更新
	for gcpID, inst := range gcpMap {
		if deletedMap[gcpID] {
			continue
		}
		if dbHost, found := dbMap[gcpID]; found {
			changed := false
			if dbHost.Label != inst.Label {
				dbHost.Label = inst.Label
				changed = true
			}
			if dbHost.Config.Host != inst.IP {
				dbHost.Config.Host = inst.IP
				changed = true
			}
			if dbHost.Config.Port != integration.DefaultPort {
				dbHost.Config.Port = integration.DefaultPort
				changed = true
			}
			if dbHost.Config.Username != integration.DefaultUsername {
				dbHost.Config.Username = integration.DefaultUsername
				changed = true
			}
			if dbHost.Config.AuthMode != integration.AuthMode {
				dbHost.Config.AuthMode = integration.AuthMode
				changed = true
			}
			if dbHost.Config.PrivateKeyPath != integration.PrivateKeyPath {
				dbHost.Config.PrivateKeyPath = integration.PrivateKeyPath
				changed = true
			}
			if dbHost.Config.CertPath != integration.CertPath {
				dbHost.Config.CertPath = integration.CertPath
				changed = true
			}
			if changed {
				if integration.AuthMode == "password" && defaultPassword != "" {
					if dbHost.Config.SecretRefs.SSHPasswordRef == "" {
						dbHost.Config.SecretRefs = fillDefaultSecretRefs(dbHost.ID, dbHost.Config.SecretRefs)
					}
					if err := s.secrets.SetSecret(ctx, dbHost.Config.SecretRefs.SSHPasswordRef, defaultPassword); err != nil {
						log.WithError(err).Errorf("同步更新 GCP Host 密碼失敗：%s", dbHost.ID)
					}
				}
				dbHost.UpdatedAt = s.now().UTC().Format(time.RFC3339)
				if err := s.repo.SaveHost(ctx, dbHost); err != nil {
					log.WithError(err).Errorf("同步更新 GCP Host 失敗：%s", gcpID)
				}
			}
		} else {
			newHost := dto.HostProfile{
				ID:            newID("h"),
				Label:         inst.Label,
				GroupID:       groupID,
				GCPInstanceID: gcpID,
				Config: dto.PersistedHostConfig{
					Host:                       inst.IP,
					Port:                       integration.DefaultPort,
					Username:                   integration.DefaultUsername,
					AuthMode:                   integration.AuthMode,
					PrivateKeyPath:             integration.PrivateKeyPath,
					CertPath:                   integration.CertPath,
					ShowSnippetsInControlPanel: true,
					StartupSnippetIDs:          []string{},
					CustomComponents:           []dto.HostCustomComponent{},
				},
				CreatedAt: s.now().UTC().Format(time.RFC3339),
				UpdatedAt: s.now().UTC().Format(time.RFC3339),
			}
			newHost.Config.SecretRefs = fillDefaultSecretRefs(newHost.ID, newHost.Config.SecretRefs)
			if integration.AuthMode == "password" && defaultPassword != "" {
				if err := s.secrets.SetSecret(ctx, newHost.Config.SecretRefs.SSHPasswordRef, defaultPassword); err != nil {
					log.WithError(err).Errorf("同步儲存 GCP Host 密碼失敗：%s", newHost.ID)
				}
			}
			if err := s.repo.SaveHost(ctx, newHost); err != nil {
				log.WithError(err).Errorf("同步新增 GCP Host 失敗：%s", gcpID)
			}
		}
	}

	// 同步：刪除
	for gcpID, dbHost := range dbMap {
		if _, found := gcpMap[gcpID]; !found {
			if err := s.DeleteHost(ctx, dbHost.ID); err != nil {
				log.WithError(err).Errorf("同步刪除 GCP Host 失敗：%s", dbHost.ID)
			}
		}
	}

	// 更新 last_sync_at
	integration.LastSyncAt = s.now().UTC().Format(time.RFC3339)
	integration.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.repo.SaveGCPIntegration(ctx, integration); err != nil {
		log.WithError(err).Errorf("更新 GCP 整合同步時間失敗：%s", groupID)
	}

	return nil
}
