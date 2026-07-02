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

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/lightsail"
)

type ec2DescribeInstancesAPI interface {
	DescribeInstances(ctx context.Context, params *ec2.DescribeInstancesInput, optFns ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error)
}

type lightsailGetInstancesAPI interface {
	GetInstances(ctx context.Context, params *lightsail.GetInstancesInput, optFns ...func(*lightsail.Options)) (*lightsail.GetInstancesOutput, error)
}

func (s *Service) ListAWSIntegrations(ctx context.Context) ([]dto.AWSIntegration, error) {
	return s.repo.ListAWSIntegrations(ctx)
}

func (s *Service) GetAWSIntegration(ctx context.Context, groupID string) (dto.AWSIntegration, error) {
	return s.repo.GetAWSIntegration(ctx, groupID)
}

func (s *Service) SaveAWSIntegration(ctx context.Context, request dto.SaveAWSIntegrationRequest) (dto.AWSIntegration, error) {
	integration := request.Integration
	previousGroupID := strings.TrimSpace(request.PreviousGroupID)
	integration.GroupID = strings.TrimSpace(integration.GroupID)
	integration.Name = strings.TrimSpace(integration.Name)
	if integration.GroupID == "" {
		return dto.AWSIntegration{}, errors.New("group_id 不可空白")
	}
	if integration.Name == "" {
		integration.Name = integration.GroupID
	}

	// 檢查 group 是否存在
	exists, err := s.repo.GroupExists(ctx, integration.GroupID)
	if err != nil {
		return dto.AWSIntegration{}, err
	}
	if !exists {
		return dto.AWSIntegration{}, fmt.Errorf("host group 不存在：%s", integration.GroupID)
	}

	ref := fmt.Sprintf("aws/%s/secret-access-key", integration.GroupID)
	integration.SecretAccessKeyRef = ref
	defaultPwdRef := fmt.Sprintf("aws/%s/default-password", integration.GroupID)
	integration.DefaultPasswordRef = defaultPwdRef

	var previousIntegration dto.AWSIntegration
	var hasPreviousIntegration bool
	if previousGroupID != "" && previousGroupID != integration.GroupID {
		previousIntegration, err = s.repo.GetAWSIntegration(ctx, previousGroupID)
		if err != nil && !errors.Is(err, storage.ErrAWSIntegrationNotFound) {
			return dto.AWSIntegration{}, err
		}
		hasPreviousIntegration = err == nil
		if hasPreviousIntegration {
			if request.Integration.SecretAccessKeyRef == "" {
				request.Integration.SecretAccessKeyRef = previousIntegration.SecretAccessKeyRef
			}
			if request.Integration.DefaultPasswordRef == "" {
				request.Integration.DefaultPasswordRef = previousIntegration.DefaultPasswordRef
			}
		}
	}

	// 處理 secret
	if request.Secrets.SecretAccessKey.Clear {
		if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.AWSIntegration{}, fmt.Errorf("清除 AWS Secret Access Key 失敗：%w", err)
		}
	} else if request.Secrets.SecretAccessKey.HasValue {
		if err := s.secrets.SetSecret(ctx, ref, request.Secrets.SecretAccessKey.Value); err != nil {
			return dto.AWSIntegration{}, fmt.Errorf("儲存 AWS Secret Access Key 失敗：%w", err)
		}
	} else if request.Integration.SecretAccessKeyRef != "" && request.Integration.SecretAccessKeyRef != ref {
		// 說明是連結現有的 AWS 整合設定（從目標帳戶複製金鑰）
		targetSecretVal, err := s.secrets.GetSecret(ctx, request.Integration.SecretAccessKeyRef)
		if err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.AWSIntegration{}, fmt.Errorf("從目標帳戶取得金鑰失敗：%w", err)
		}
		if err == nil {
			if err := s.secrets.SetSecret(ctx, ref, targetSecretVal); err != nil {
				return dto.AWSIntegration{}, fmt.Errorf("複製 AWS Secret Access Key 失敗：%w", err)
			}
		}
	}

	// 處理 default password secret
	if request.Secrets.DefaultPassword.Clear {
		if err := s.secrets.DeleteSecret(ctx, defaultPwdRef); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.AWSIntegration{}, fmt.Errorf("清除 AWS 預設密碼失敗：%w", err)
		}
	} else if request.Secrets.DefaultPassword.HasValue {
		if err := s.secrets.SetSecret(ctx, defaultPwdRef, request.Secrets.DefaultPassword.Value); err != nil {
			return dto.AWSIntegration{}, fmt.Errorf("儲存 AWS 預設密碼失敗：%w", err)
		}
	} else if request.Integration.DefaultPasswordRef != "" && request.Integration.DefaultPasswordRef != defaultPwdRef {
		// 說明是連結現有的 AWS 整合設定（從目標帳戶複製金鑰）
		targetSecretVal, err := s.secrets.GetSecret(ctx, request.Integration.DefaultPasswordRef)
		if err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			return dto.AWSIntegration{}, fmt.Errorf("從目標帳戶取得預設密碼失敗：%w", err)
		}
		if err == nil {
			if err := s.secrets.SetSecret(ctx, defaultPwdRef, targetSecretVal); err != nil {
				return dto.AWSIntegration{}, fmt.Errorf("複製 AWS 預設密碼失敗：%w", err)
			}
		}
	}

	// 載入既有的來保留 CreatedAt
	existing, err := s.repo.GetAWSIntegration(ctx, integration.GroupID)
	if err == nil {
		integration.CreatedAt = existing.CreatedAt
	} else {
		integration.CreatedAt = s.now().UTC().Format(time.RFC3339)
	}
	integration.UpdatedAt = s.now().UTC().Format(time.RFC3339)

	if err := s.repo.SaveAWSIntegration(ctx, integration); err != nil {
		return dto.AWSIntegration{}, err
	}

	if hasPreviousIntegration && previousGroupID != integration.GroupID {
		hosts, err := s.repo.ListHosts(ctx)
		if err != nil {
			return dto.AWSIntegration{}, err
		}
		for _, host := range hosts {
			if host.GroupID != previousGroupID || strings.TrimSpace(host.AWSInstanceID) == "" {
				continue
			}
			host.GroupID = integration.GroupID
			host.UpdatedAt = s.now().UTC().Format(time.RFC3339)
			if err := s.repo.SaveHost(ctx, host); err != nil {
				return dto.AWSIntegration{}, err
			}
		}
		if err := s.DeleteAWSIntegration(ctx, previousGroupID); err != nil {
			return dto.AWSIntegration{}, err
		}
	}

	return integration, nil
}

func (s *Service) DeleteAWSIntegration(ctx context.Context, groupID string) error {
	groupID = strings.TrimSpace(groupID)
	log.WithField("groupId", groupID).Info("刪除 AWS Integration 設定")
	if err := s.repo.DeleteAWSIntegration(ctx, groupID); err != nil {
		return err
	}
	if err := s.repo.CleanDeletedAWSInstancesByGroup(ctx, groupID); err != nil {
		log.WithError(err).Warnf("清除群組已刪除 AWS 實例排除記錄失敗：%s", groupID)
	}
	ref := fmt.Sprintf("aws/%s/secret-access-key", groupID)
	if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
		log.WithError(err).Warnf("刪除 AWS 整合設定時，清除 Secret 失敗：%s", ref)
	}
	pwdRef := fmt.Sprintf("aws/%s/default-password", groupID)
	if err := s.secrets.DeleteSecret(ctx, pwdRef); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
		log.WithError(err).Warnf("刪除 AWS 整合設定時，清除預設密碼 Secret 失敗：%s", pwdRef)
	}
	return nil
}

type awsInstanceInfo struct {
	ID    string
	Label string
	IP    string
}

func (s *Service) SyncAWS(ctx context.Context, groupID string) error {
	integration, err := s.repo.GetAWSIntegration(ctx, groupID)
	if err != nil {
		return err
	}

	// 取得 secret
	secretKey, err := s.secrets.GetSecret(ctx, integration.SecretAccessKeyRef)
	if err != nil {
		return fmt.Errorf("無法取得 AWS Secret Access Key：%w", err)
	}

	var defaultPassword string
	if integration.AuthMode == "password" {
		if integration.DefaultPasswordRef != "" {
			var err error
			defaultPassword, err = s.secrets.GetSecret(ctx, integration.DefaultPasswordRef)
			if err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
				return fmt.Errorf("無法取得 AWS 預設密碼：%w", err)
			}
		}
	}

	// 載入 AWS 配置
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(integration.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(integration.AccessKeyID, secretKey, "")),
	)
	if err != nil {
		return fmt.Errorf("初始化 AWS 設定失敗：%w", err)
	}

	var allAWSInstances []awsInstanceInfo

	// 拉取 EC2
	if integration.ImportSource == "ec2" || integration.ImportSource == "both" {
		var ec2Client ec2DescribeInstancesAPI
		if s.ec2ClientBuilder != nil {
			ec2Client = s.ec2ClientBuilder(cfg)
		} else {
			ec2Client = ec2.NewFromConfig(cfg)
		}
		input := &ec2.DescribeInstancesInput{}
		paginator := ec2.NewDescribeInstancesPaginator(ec2Client, input)
		for paginator.HasMorePages() {
			page, err := paginator.NextPage(ctx)
			if err != nil {
				return fmt.Errorf("取得 EC2 實例失敗：%w", err)
			}
			for _, reservation := range page.Reservations {
				for _, instance := range reservation.Instances {
					name := ""
					for _, tag := range instance.Tags {
						if tag.Key != nil && *tag.Key == "Name" && tag.Value != nil {
							name = *tag.Value
							break
						}
					}
					if name == "" && instance.InstanceId != nil {
						name = *instance.InstanceId
					}

					ip := ""
					if integration.IPAddressType == "private" {
						if instance.PrivateIpAddress != nil {
							ip = *instance.PrivateIpAddress
						}
					} else {
						if instance.PublicIpAddress != nil {
							ip = *instance.PublicIpAddress
						} else if instance.PrivateIpAddress != nil {
							ip = *instance.PrivateIpAddress
						}
					}

					if ip == "" || instance.InstanceId == nil {
						continue
					}

					allAWSInstances = append(allAWSInstances, awsInstanceInfo{
						ID:    fmt.Sprintf("aws/ec2/%s", *instance.InstanceId),
						Label: name,
						IP:    ip,
					})
				}
			}
		}
	}

	// 拉取 Lightsail
	if integration.ImportSource == "lightsail" || integration.ImportSource == "both" {
		var lightsailClient lightsailGetInstancesAPI
		if s.lightsailClientBuilder != nil {
			lightsailClient = s.lightsailClientBuilder(cfg)
		} else {
			lightsailClient = lightsail.NewFromConfig(cfg)
		}
		input := &lightsail.GetInstancesInput{}
		for {
			output, err := lightsailClient.GetInstances(ctx, input)
			if err != nil {
				return fmt.Errorf("取得 Lightsail 實例失敗：%w", err)
			}
			for _, instance := range output.Instances {
				name := ""
				if instance.Name != nil {
					name = *instance.Name
				}
				if name == "" {
					continue
				}

				ip := ""
				if integration.IPAddressType == "private" {
					if instance.PrivateIpAddress != nil {
						ip = *instance.PrivateIpAddress
					}
				} else {
					if instance.PublicIpAddress != nil {
						ip = *instance.PublicIpAddress
					} else if instance.PrivateIpAddress != nil {
						ip = *instance.PrivateIpAddress
					}
				}

				if ip == "" {
					continue
				}

				allAWSInstances = append(allAWSInstances, awsInstanceInfo{
					ID:    fmt.Sprintf("aws/lightsail/%s", name),
					Label: name,
					IP:    ip,
				})
			}
			if output.NextPageToken == nil || *output.NextPageToken == "" {
				break
			}
			input.PageToken = output.NextPageToken
		}
	}

	// 取得目前 Group 下的所有 hosts
	allHosts, err := s.repo.ListHosts(ctx)
	if err != nil {
		return err
	}
	var groupHosts []dto.HostProfile
	for _, h := range allHosts {
		if h.GroupID == groupID && h.AWSInstanceID != "" {
			groupHosts = append(groupHosts, h)
		}
	}

	awsMap := make(map[string]awsInstanceInfo)
	for _, inst := range allAWSInstances {
		awsMap[inst.ID] = inst
	}

	// 取得該群組下已被刪除的 AWS 排除名單，並執行自我清理
	deletedInstances, err := s.repo.ListDeletedAWSInstances(ctx, groupID)
	if err != nil {
		return err
	}
	deletedMap := make(map[string]bool)
	for _, id := range deletedInstances {
		if _, found := awsMap[id]; found {
			deletedMap[id] = true
		} else {
			if err := s.repo.DeleteDeletedAWSInstance(ctx, id); err != nil {
				log.WithError(err).Warnf("清除無效的已刪除 AWS 實例記錄失敗：%s", id)
			}
		}
	}

	dbMap := make(map[string]dto.HostProfile)
	for _, h := range groupHosts {
		dbMap[h.AWSInstanceID] = h
	}

	// 同步：新增或更新
	for awsID, inst := range awsMap {
		if deletedMap[awsID] {
			continue
		}
		if dbHost, found := dbMap[awsID]; found {
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
						log.WithError(err).Errorf("同步更新 AWS Host 密碼失敗：%s", dbHost.ID)
					}
				}
				dbHost.UpdatedAt = s.now().UTC().Format(time.RFC3339)
				if err := s.repo.SaveHost(ctx, dbHost); err != nil {
					log.WithError(err).Errorf("同步更新 AWS Host 失敗：%s", awsID)
				}
			}
		} else {
			newHost := dto.HostProfile{
				ID:            newID("h"),
				Label:         inst.Label,
				GroupID:       groupID,
				AWSInstanceID: awsID,
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
					log.WithError(err).Errorf("同步儲存 AWS Host 密碼失敗：%s", newHost.ID)
				}
			}
			if err := s.repo.SaveHost(ctx, newHost); err != nil {
				log.WithError(err).Errorf("同步新增 AWS Host 失敗：%s", awsID)
			}
		}
	}

	// 同步：刪除
	for awsID, dbHost := range dbMap {
		if _, found := awsMap[awsID]; !found {
			if err := s.DeleteHost(ctx, dbHost.ID); err != nil {
				log.WithError(err).Errorf("同步刪除 AWS Host 失敗：%s", dbHost.ID)
			}
		}
	}

	// 更新 last_sync_at
	integration.LastSyncAt = s.now().UTC().Format(time.RFC3339)
	integration.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.repo.SaveAWSIntegration(ctx, integration); err != nil {
		log.WithError(err).Errorf("更新 AWS 整合同步時間失敗：%s", groupID)
	}

	return nil
}
