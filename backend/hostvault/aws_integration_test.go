package hostvault

import (
	"context"
	"errors"
	"testing"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/lightsail"
	lightsailtypes "github.com/aws/aws-sdk-go-v2/service/lightsail/types"
)

type mockEC2Client struct {
	DescribeInstancesFunc func(ctx context.Context, params *ec2.DescribeInstancesInput, optFns ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error)
}

func (m *mockEC2Client) DescribeInstances(ctx context.Context, params *ec2.DescribeInstancesInput, optFns ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error) {
	return m.DescribeInstancesFunc(ctx, params, optFns...)
}

type mockLightsailClient struct {
	GetInstancesFunc func(ctx context.Context, params *lightsail.GetInstancesInput, optFns ...func(*lightsail.Options)) (*lightsail.GetInstancesOutput, error)
}

func (m *mockLightsailClient) GetInstances(ctx context.Context, params *lightsail.GetInstancesInput, optFns ...func(*lightsail.Options)) (*lightsail.GetInstancesOutput, error) {
	return m.GetInstancesFunc(ctx, params, optFns...)
}

func TestSyncAWS(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	// 1. 建立測試用的 Host Group
	groupID := "aws-test-group"
	if _, err := svc.SaveGroup(ctx, dto.HostGroup{
		ID:   groupID,
		Name: "AWS Integration Group",
	}); err != nil {
		t.Fatalf("SaveGroup 失敗：%v", err)
	}

	// 2. 驗證金鑰存取是否安全使用 OS Credential Store (secrets.Service)
	// 當我們調用 SaveAWSIntegration 時，AWS Secret Access Key 應被存入憑證存放區。
	secretKeyVal := "my-aws-secret-access-key-12345"
	integrationReq := dto.SaveAWSIntegrationRequest{
		Integration: dto.AWSIntegration{
			GroupID:         groupID,
			Name:            "Production AWS Account",
			Region:          "us-east-1",
			AccessKeyID:     "AKIAIOSFODNN7EXAMPLE",
			ImportSource:    "both",
			IPAddressType:   "public",
			DefaultPort:     22,
			DefaultUsername: "ubuntu",
			AuthMode:        constants.AuthModeKey,
		},
		Secrets: dto.AWSIntegrationSecretsInput{
			SecretAccessKey: dto.SecretValueInput{
				Value:    secretKeyVal,
				HasValue: true,
			},
		},
	}

	integration, err := svc.SaveAWSIntegration(ctx, integrationReq)
	if err != nil {
		t.Fatalf("SaveAWSIntegration 失敗：%v", err)
	}
	if integration.Name != "Production AWS Account" {
		t.Fatalf("AWSIntegration.Name = %q，預期 Production AWS Account", integration.Name)
	}
	if integration.GroupID != groupID {
		t.Fatalf("AWSIntegration.GroupID = %q，預期 %s", integration.GroupID, groupID)
	}

	// 驗證金鑰是否安全儲存在 OS Credential Store (即 secretStore 模擬區中)
	storedSecret, err := secretStore.GetSecret(ctx, integration.SecretAccessKeyRef)
	if err != nil {
		t.Fatalf("無法從 Secret 存放區取得金鑰：%v", err)
	}
	if storedSecret != secretKeyVal {
		t.Errorf("取得的金鑰為 %q，與期望的 %q 不符", storedSecret, secretKeyVal)
	}

	// 3. 測試情境一：正常同步時，AWS 中新增的虛擬機器是否被自動寫入本地資料庫。
	var ec2Instances []ec2types.Instance
	var lightsailInstances []lightsailtypes.Instance

	// 設定 Mock Builders
	svc.ec2ClientBuilder = func(cfg aws.Config) ec2DescribeInstancesAPI {
		return &mockEC2Client{
			DescribeInstancesFunc: func(ctx context.Context, params *ec2.DescribeInstancesInput, optFns ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error) {
				return &ec2.DescribeInstancesOutput{
					Reservations: []ec2types.Reservation{
						{
							Instances: ec2Instances,
						},
					},
				}, nil
			},
		}
	}

	svc.lightsailClientBuilder = func(cfg aws.Config) lightsailGetInstancesAPI {
		return &mockLightsailClient{
			GetInstancesFunc: func(ctx context.Context, params *lightsail.GetInstancesInput, optFns ...func(*lightsail.Options)) (*lightsail.GetInstancesOutput, error) {
				return &lightsail.GetInstancesOutput{
					Instances: lightsailInstances,
				}, nil
			},
		}
	}

	// 初始化 Mock AWS 實例資料
	ec2Instances = []ec2types.Instance{
		{
			InstanceId:       aws.String("i-ec2instance123"),
			PublicIpAddress:  aws.String("54.210.1.2"),
			PrivateIpAddress: aws.String("10.0.1.2"),
			Tags: []ec2types.Tag{
				{
					Key:   aws.String("Name"),
					Value: aws.String("EC2-Web-Server"),
				},
			},
		},
	}

	lightsailInstances = []lightsailtypes.Instance{
		{
			Name:             aws.String("Lightsail-DB-Server"),
			PublicIpAddress:  aws.String("54.210.1.3"),
			PrivateIpAddress: aws.String("10.0.1.3"),
		},
	}

	// 執行同步
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 第一次同步失敗：%v", err)
	}

	// 驗證本地資料庫中是否正確寫入
	hosts, err := svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}

	var foundEC2, foundLightsail bool
	var ec2HostID, lightsailHostID string
	for _, h := range hosts {
		if h.GroupID == groupID {
			if h.AWSInstanceID == "aws/ec2/i-ec2instance123" {
				foundEC2 = true
				ec2HostID = h.ID
				if h.Label != "EC2-Web-Server" {
					t.Errorf("EC2 Host Label 錯誤，為：%q", h.Label)
				}
				if h.Config.Host != "54.210.1.2" {
					t.Errorf("EC2 Host IP 錯誤，為：%q", h.Config.Host)
				}
			} else if h.AWSInstanceID == "aws/lightsail/Lightsail-DB-Server" {
				foundLightsail = true
				lightsailHostID = h.ID
				if h.Label != "Lightsail-DB-Server" {
					t.Errorf("Lightsail Host Label 錯誤，為：%q", h.Label)
				}
				if h.Config.Host != "54.210.1.3" {
					t.Errorf("Lightsail Host IP 錯誤，為：%q", h.Config.Host)
				}
			}
		}
	}

	if !foundEC2 {
		t.Errorf("未能同步新增 EC2 實例")
	}
	if !foundLightsail {
		t.Errorf("未能同步新增 Lightsail 實例")
	}

	// 4. 測試情境二：當 AWS 中的虛擬機器 IP 或名稱改變時，本地資料庫的對應 Host 欄位是否正確更新。
	ec2Instances = []ec2types.Instance{
		{
			InstanceId:       aws.String("i-ec2instance123"),
			PublicIpAddress:  aws.String("54.210.1.20"), // IP 改變
			PrivateIpAddress: aws.String("10.0.1.2"),
			Tags: []ec2types.Tag{
				{
					Key:   aws.String("Name"),
					Value: aws.String("EC2-Web-Server-Updated"), // 名稱改變
				},
			},
		},
	}

	lightsailInstances = []lightsailtypes.Instance{
		{
			Name:             aws.String("Lightsail-DB-Server"),
			PublicIpAddress:  aws.String("54.210.1.30"), // IP 改變
			PrivateIpAddress: aws.String("10.0.1.3"),
		},
	}

	// 再次執行同步
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 第二次同步失敗：%v", err)
	}

	// 驗證本地資料庫中是否正確更新
	hosts, err = svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}

	for _, h := range hosts {
		if h.GroupID == groupID {
			if h.AWSInstanceID == "aws/ec2/i-ec2instance123" {
				if h.Label != "EC2-Web-Server-Updated" {
					t.Errorf("EC2 Host Label 更新失敗，為：%q", h.Label)
				}
				if h.Config.Host != "54.210.1.20" {
					t.Errorf("EC2 Host IP 更新失敗，為：%q", h.Config.Host)
				}
			} else if h.AWSInstanceID == "aws/lightsail/Lightsail-DB-Server" {
				if h.Config.Host != "54.210.1.30" {
					t.Errorf("Lightsail Host IP 更新失敗，為：%q", h.Config.Host)
				}
			}
		}
	}

	// 5. 測試情境三：當 AWS 中刪除虛擬機器時，本地資料庫是否正確刪除該 Host。
	// 清空 AWS 實例，模擬兩台虛擬機器均已在 AWS 中被刪除
	ec2Instances = []ec2types.Instance{}
	lightsailInstances = []lightsailtypes.Instance{}

	// 再次執行同步
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 第三次同步失敗：%v", err)
	}

	// 驗證本地資料庫是否正確刪下了這兩個 Host
	hosts, err = svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}

	for _, h := range hosts {
		if h.ID == ec2HostID || h.ID == lightsailHostID {
			t.Errorf("同步刪除失敗，Host 依然存在：ID=%s, Label=%s", h.ID, h.Label)
		}
	}

	// 6. 測試情境四：AWS 同步主機手動刪除後防自動恢復、自我清理與刪除整合之清理機制。
	// 重新設定兩台 Mock AWS 實例
	ec2Instances = []ec2types.Instance{
		{
			InstanceId:       aws.String("i-ec2instance999"),
			PublicIpAddress:  aws.String("54.210.9.9"),
			PrivateIpAddress: aws.String("10.0.9.9"),
			Tags: []ec2types.Tag{
				{
					Key:   aws.String("Name"),
					Value: aws.String("EC2-Test-VM"),
				},
			},
		},
	}
	lightsailInstances = []lightsailtypes.Instance{
		{
			Name:             aws.String("Lightsail-Test-VM"),
			PublicIpAddress:  aws.String("54.210.9.10"),
			PrivateIpAddress: aws.String("10.0.9.10"),
		},
	}

	// 第一次同步，將其拉入本地資料庫
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 情境四第一次同步失敗：%v", err)
	}

	// 取得新增後的 Host 資訊
	hosts, err = svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}

	var targetEC2Host dto.HostProfile
	var targetLightsailHost dto.HostProfile
	for _, h := range hosts {
		if h.AWSInstanceID == "aws/ec2/i-ec2instance999" {
			targetEC2Host = h
		} else if h.AWSInstanceID == "aws/lightsail/Lightsail-Test-VM" {
			targetLightsailHost = h
		}
	}

	if targetEC2Host.ID == "" || targetLightsailHost.ID == "" {
		t.Fatalf("未成功同步建立測試 AWS 主機")
	}

	// 模擬手動刪除 EC2 主機
	if err := svc.DeleteHost(ctx, targetEC2Host.ID); err != nil {
		t.Fatalf("DeleteHost 失敗：%v", err)
	}

	// 驗證已刪除主機之 ID 寫入排除表
	deletedList, err := svc.repo.ListDeletedAWSInstances(ctx, groupID)
	if err != nil {
		t.Fatalf("ListDeletedAWSInstances 失敗：%v", err)
	}
	foundInExclusion := false
	for _, instID := range deletedList {
		if instID == "aws/ec2/i-ec2instance999" {
			foundInExclusion = true
			break
		}
	}
	if !foundInExclusion {
		t.Errorf("被刪除之 AWS 實例 ID 未記錄至排除表中")
	}

	// 再次執行同步，此時 AWS 端依然回傳這兩台實例
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 情境四第二次同步失敗：%v", err)
	}

	// 驗證已被手動刪除的 EC2 主機沒有被自動恢復，而未刪除的 Lightsail 主機依然存在
	hosts, err = svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}

	for _, h := range hosts {
		if h.AWSInstanceID == "aws/ec2/i-ec2instance999" {
			t.Errorf("被手動刪除的 AWS 主機在同步後死而復生了")
		}
	}

	// 模擬該實例在 AWS 端已被永久刪除（移出 mock API 列表）
	ec2Instances = []ec2types.Instance{}

	// 再次執行同步
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 情境四第三次同步失敗：%v", err)
	}

	// 驗證排除表已被自我清理機制清空（因 AWS API 端該實例已不存在）
	deletedList, err = svc.repo.ListDeletedAWSInstances(ctx, groupID)
	if err != nil {
		t.Fatalf("ListDeletedAWSInstances 失敗：%v", err)
	}
	if len(deletedList) != 0 {
		t.Errorf("自我清理機制未發揮作用，排除表中仍有紀錄：%v", deletedList)
	}

	// 再次把實例加回並刪除主機以寫入排除表，測試刪除整合設定時是否清理排除表
	ec2Instances = []ec2types.Instance{
		{
			InstanceId:       aws.String("i-ec2instance999"),
			PublicIpAddress:  aws.String("54.210.9.9"),
			PrivateIpAddress: aws.String("10.0.9.9"),
			Tags: []ec2types.Tag{
				{
					Key:   aws.String("Name"),
					Value: aws.String("EC2-Test-VM"),
				},
			},
		},
	}
	if err := svc.SyncAWS(ctx, groupID); err != nil {
		t.Fatalf("SyncAWS 恢復同步失敗：%v", err)
	}
	hosts, _ = svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.AWSInstanceID == "aws/ec2/i-ec2instance999" {
			_ = svc.DeleteHost(ctx, h.ID)
		}
	}

	// 驗證寫入排除表
	deletedList, _ = svc.repo.ListDeletedAWSInstances(ctx, groupID)
	if len(deletedList) == 0 {
		t.Fatalf("排除表應有新記錄，但為空")
	}

	// 刪除 AWS 整合
	if err := svc.DeleteAWSIntegration(ctx, groupID); err != nil {
		t.Fatalf("DeleteAWSIntegration 失敗：%v", err)
	}

	// 驗證排除表已隨之被清理
	deletedList, _ = svc.repo.ListDeletedAWSInstances(ctx, groupID)
	if len(deletedList) != 0 {
		t.Errorf("刪除 AWS 整合後，排除表未被清理：%v", deletedList)
	}
}

func TestSaveAWSIntegrationMoveGroup(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	oldGroupID := "aws-old-group"
	newGroupID := "aws-new-group"

	if _, err := svc.SaveGroup(ctx, dto.HostGroup{ID: oldGroupID, Name: "Old Group"}); err != nil {
		t.Fatalf("SaveGroup old 失敗：%v", err)
	}
	if _, err := svc.SaveGroup(ctx, dto.HostGroup{ID: newGroupID, Name: "New Group"}); err != nil {
		t.Fatalf("SaveGroup new 失敗：%v", err)
	}

	created, err := svc.SaveAWSIntegration(ctx, dto.SaveAWSIntegrationRequest{
		Integration: dto.AWSIntegration{
			GroupID:         oldGroupID,
			Name:            "AWS Prod",
			Region:          "ap-northeast-1",
			AccessKeyID:     "AKIAOLDKEY",
			ImportSource:    "both",
			IPAddressType:   "public",
			DefaultPort:     22,
			DefaultUsername: "ubuntu",
			AuthMode:        constants.AuthModePassword,
		},
		Secrets: dto.AWSIntegrationSecretsInput{
			SecretAccessKey: dto.SecretValueInput{
				Value:    "old-secret-value",
				HasValue: true,
			},
		},
	})
	if err != nil {
		t.Fatalf("建立 AWS Integration 失敗：%v", err)
	}

	savedHost, _, err := svc.SaveHost(ctx, dto.SaveHostRequest{
		Host: dto.HostProfile{
			ID:            "h_aws_sync_old",
			Label:         "EC2 Old",
			GroupID:       oldGroupID,
			AWSInstanceID: "aws/ec2/i-old",
			Config: dto.PersistedHostConfig{
				Host:     "10.0.0.1",
				Port:     22,
				Username: "ubuntu",
				AuthMode: constants.AuthModePassword,
			},
		},
	})
	if err != nil {
		t.Fatalf("建立舊群組 AWS Host 失敗：%v", err)
	}

	moved, err := svc.SaveAWSIntegration(ctx, dto.SaveAWSIntegrationRequest{
		Integration: dto.AWSIntegration{
			GroupID:            newGroupID,
			Name:               "AWS Prod",
			Region:             "ap-northeast-1",
			AccessKeyID:        "AKIAOLDKEY",
			ImportSource:       "both",
			IPAddressType:      "public",
			DefaultPort:        22,
			DefaultUsername:    "ubuntu",
			AuthMode:           constants.AuthModePassword,
			SecretAccessKeyRef: created.SecretAccessKeyRef,
		},
		Secrets:         dto.AWSIntegrationSecretsInput{},
		PreviousGroupID: oldGroupID,
	})
	if err != nil {
		t.Fatalf("移轉 AWS Integration 失敗：%v", err)
	}

	if moved.GroupID != newGroupID {
		t.Fatalf("移轉後 GroupID = %q，預期 %q", moved.GroupID, newGroupID)
	}

	if _, err := svc.GetAWSIntegration(ctx, oldGroupID); err == nil {
		t.Fatalf("舊群組的 AWS Integration 應已刪除")
	}

	gotNew, err := svc.GetAWSIntegration(ctx, newGroupID)
	if err != nil {
		t.Fatalf("讀取新群組 AWS Integration 失敗：%v", err)
	}
	if gotNew.Name != "AWS Prod" {
		t.Fatalf("新群組 AWS Integration 名稱錯誤：%q", gotNew.Name)
	}

	newSecret, err := secretStore.GetSecret(ctx, gotNew.SecretAccessKeyRef)
	if err != nil {
		t.Fatalf("取得新群組 secret 失敗：%v", err)
	}
	if newSecret != "old-secret-value" {
		t.Fatalf("新群組 secret = %q，預期 old-secret-value", newSecret)
	}

	if _, err := secretStore.GetSecret(ctx, created.SecretAccessKeyRef); !errors.Is(err, secrets.ErrSecretNotFound) {
		t.Fatalf("舊群組 secret 應已被清除，實際 err=%v", err)
	}

	hosts, err := svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts 失敗：%v", err)
	}

	var movedHost dto.HostProfile
	foundHost := false
	for _, host := range hosts {
		if host.ID == savedHost.ID {
			movedHost = host
			foundHost = true
			break
		}
	}
	if !foundHost {
		t.Fatalf("找不到移轉後的 AWS Host：%s", savedHost.ID)
	}
	if movedHost.GroupID != newGroupID {
		t.Fatalf("AWS Host 群組未隨 Integration 移轉，實際 %q", movedHost.GroupID)
	}
}

func TestAWSIntegrationConnectionAndSync(t *testing.T) {
	secretStore := secrets.NewMemoryStore()
	svc := newTestService(t, secretStore)
	ctx := context.Background()

	// 1. 建立群組 A 與群組 B
	groupA := "group-a"
	groupB := "group-b"
	_, _ = svc.SaveGroup(ctx, dto.HostGroup{ID: groupA, Name: "Group A"})
	_, _ = svc.SaveGroup(ctx, dto.HostGroup{ID: groupB, Name: "Group B"})

	// 2. 在群組 A 建立 AWS 整合與金鑰
	integrationReqA := dto.SaveAWSIntegrationRequest{
		Integration: dto.AWSIntegration{
			GroupID:         groupA,
			Region:          "us-east-1",
			AccessKeyID:     "AKIA-A",
			ImportSource:    "ec2",
			IPAddressType:   "public",
			DefaultPort:     22,
			DefaultUsername: "ubuntu",
			AuthMode:        constants.AuthModeKey,
		},
		Secrets: dto.AWSIntegrationSecretsInput{
			SecretAccessKey: dto.SecretValueInput{
				Value:    "secret-key-a",
				HasValue: true,
			},
		},
	}
	_, err := svc.SaveAWSIntegration(ctx, integrationReqA)
	if err != nil {
		t.Fatalf("群組 A 儲存 AWS 整合失敗：%v", err)
	}

	// 3. 測試連結目標帳戶功能：在群組 B 儲存 AWS 整合，指定 SecretAccessKeyRef 為群組 A 的 Ref，HasValue 為 false
	integrationReqB := dto.SaveAWSIntegrationRequest{
		Integration: dto.AWSIntegration{
			GroupID:            groupB,
			Region:             "us-east-1",
			AccessKeyID:        "AKIA-A",                        // 使用與群組 A 相同的設定
			SecretAccessKeyRef: "aws/group-a/secret-access-key", // 指向群組 A
			ImportSource:       "ec2",
			IPAddressType:      "public",
			DefaultPort:        22,
			DefaultUsername:    "ubuntu",
			AuthMode:           constants.AuthModeKey,
		},
		Secrets: dto.AWSIntegrationSecretsInput{
			SecretAccessKey: dto.SecretValueInput{
				HasValue: false, // 密鑰由後端複製
			},
		},
	}
	_, err = svc.SaveAWSIntegration(ctx, integrationReqB)
	if err != nil {
		t.Fatalf("群組 B 儲存 AWS 整合失敗：%v", err)
	}

	// 驗證群組 B 的金鑰是否已成功從群組 A 複製過來
	copiedSecret, err := secretStore.GetSecret(ctx, "aws/group-b/secret-access-key")
	if err != nil {
		t.Fatalf("無法取得複製後的群組 B 金鑰：%v", err)
	}
	if copiedSecret != "secret-key-a" {
		t.Errorf("群組 B 金鑰複製錯誤，為：%q，期望為：%q", copiedSecret, "secret-key-a")
	}

	// 4. 測試屬性同步更新功能：模擬 AWS 同步出一個主機，原本預設 Port 是 22
	var ec2Instances []ec2types.Instance
	svc.ec2ClientBuilder = func(cfg aws.Config) ec2DescribeInstancesAPI {
		return &mockEC2Client{
			DescribeInstancesFunc: func(ctx context.Context, params *ec2.DescribeInstancesInput, optFns ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error) {
				return &ec2.DescribeInstancesOutput{
					Reservations: []ec2types.Reservation{
						{
							Instances: ec2Instances,
						},
					},
				}, nil
			},
		}
	}

	ec2Instances = []ec2types.Instance{
		{
			InstanceId:       aws.String("i-ec2instance888"),
			PublicIpAddress:  aws.String("54.210.8.8"),
			PrivateIpAddress: aws.String("10.0.8.8"),
			Tags: []ec2types.Tag{
				{
					Key:   aws.String("Name"),
					Value: aws.String("EC2-Port-Test"),
				},
			},
		},
	}

	// 執行第一次同步
	if err := svc.SyncAWS(ctx, groupA); err != nil {
		t.Fatalf("SyncAWS 失敗：%v", err)
	}

	// 驗證 Port 為 22
	hosts, _ := svc.ListHosts(ctx)
	var testHost dto.HostProfile
	for _, h := range hosts {
		if h.AWSInstanceID == "aws/ec2/i-ec2instance888" {
			testHost = h
			break
		}
	}
	if testHost.Config.Port != 22 {
		t.Errorf("第一次同步之 Port 應為 22，實際為：%d", testHost.Config.Port)
	}

	// 修改群組 A 的 AWS 整合配置（將 DefaultPort 修改為 2222，將 DefaultUsername 改為 centos）
	integrationReqA.Integration.DefaultPort = 2222
	integrationReqA.Integration.DefaultUsername = "centos"
	integrationReqA.Secrets.SecretAccessKey.HasValue = false // 不更新金鑰
	if _, err := svc.SaveAWSIntegration(ctx, integrationReqA); err != nil {
		t.Fatalf("修改群組 A 整合設定失敗：%v", err)
	}

	// 再次執行同步，此時 AWS API 返回依然相同，但我們預期主機 Port 和 Username 都會同步更新為 2222 和 centos
	if err := svc.SyncAWS(ctx, groupA); err != nil {
		t.Fatalf("再次 SyncAWS 失敗：%v", err)
	}

	// 驗證主機連線設定已更新
	hosts, _ = svc.ListHosts(ctx)
	for _, h := range hosts {
		if h.AWSInstanceID == "aws/ec2/i-ec2instance888" {
			if h.Config.Port != 2222 {
				t.Errorf("同步更新連線 Port 設定失敗，為：%d，期望為 2222", h.Config.Port)
			}
			if h.Config.Username != "centos" {
				t.Errorf("同步更新連線 Username 設定失敗，為：%q，期望為 centos", h.Config.Username)
			}
		}
	}
}
