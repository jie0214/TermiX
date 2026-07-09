package hostvault

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jie0214/TermiX/backend/common"
	"github.com/jie0214/TermiX/backend/keychain"
	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"

	"github.com/aws/aws-sdk-go-v2/aws"
)

var log = common.DomainLogger("hostvault")

type Service struct {
	repo                    *storage.Repository
	secrets                 secrets.SecretStore
	keychain                *keychain.Service
	now                     func() time.Time
	ec2ClientBuilder        func(cfg aws.Config) ec2DescribeInstancesAPI
	lightsailClientBuilder  func(cfg aws.Config) lightsailGetInstancesAPI
	gcpComputeClientBuilder func(ctx context.Context, serviceAccountJSON string) (gcpComputeInstancesAPI, error)
}

func NewService(repo *storage.Repository, secretStore secrets.SecretStore, keychainSvc *keychain.Service) *Service {
	return &Service{
		repo:     repo,
		secrets:  secretStore,
		keychain: keychainSvc,
		now:      time.Now,
	}
}

func newServiceForTest(repo *storage.Repository, secretStore secrets.SecretStore, now func() time.Time) *Service {
	return &Service{
		repo:     repo,
		secrets:  secretStore,
		keychain: keychain.NewService(repo, secretStore),
		now:      now,
	}
}

func (s *Service) ListHosts(ctx context.Context) ([]dto.HostProfile, error) {
	return s.repo.ListHosts(ctx)
}

func (s *Service) GetHost(ctx context.Context, hostID string) (dto.HostProfile, error) {
	return s.repo.GetHost(ctx, hostID)
}

func (s *Service) SaveHost(ctx context.Context, request dto.SaveHostRequest) (dto.HostProfile, int, error) {
	existing, found, err := s.getExistingHost(ctx, request.Host.ID)
	if err != nil {
		return dto.HostProfile{}, 0, err
	}

	host, err := s.normalizeHost(request.Host, existing, found)
	if err != nil {
		return dto.HostProfile{}, 0, err
	}
	if host.GroupID != "" {
		exists, err := s.repo.GroupExists(ctx, host.GroupID)
		if err != nil {
			return dto.HostProfile{}, 0, err
		}
		if !exists {
			return dto.HostProfile{}, 0, fmt.Errorf("host group 不存在：%s", host.GroupID)
		}
	}

	rollback, secretWrites, err := s.applySecretMutations(ctx, host, request.Secrets)
	if err != nil {
		return dto.HostProfile{}, 0, err
	}

	if err := s.repo.SaveHost(ctx, host); err != nil {
		if rollbackErr := rollback(ctx); rollbackErr != nil {
			return dto.HostProfile{}, 0, fmt.Errorf("儲存 host 失敗且 secret 回滾失敗：%v；原始錯誤：%w", rollbackErr, err)
		}
		return dto.HostProfile{}, 0, err
	}

	log.WithFields(map[string]any{
		"hostId": host.ID,
		"alias":  host.Alias,
	}).Info("儲存 host 設定")

	return host, secretWrites, nil
}

func (s *Service) DeleteHost(ctx context.Context, hostID string) error {
	host, err := s.repo.GetHost(ctx, hostID)
	if err != nil {
		return err
	}
	if host.AWSInstanceID != "" {
		if err := s.repo.AddDeletedAWSInstance(ctx, host.AWSInstanceID, host.GroupID); err != nil {
			log.WithError(err).Warnf("將已刪除之 AWS 實例記錄寫入排除表失敗：%s", host.AWSInstanceID)
		}
	}
	if host.GCPInstanceID != "" {
		if err := s.repo.AddDeletedGCPInstance(ctx, host.GCPInstanceID, host.GroupID); err != nil {
			log.WithError(err).Warnf("將已刪除之 GCP 實例記錄寫入排除表失敗：%s", host.GCPInstanceID)
		}
	}
	if err := s.repo.DeleteHost(ctx, hostID); err != nil {
		return err
	}

	cleanupErrs := make([]string, 0)
	for _, ref := range []string{
		host.Config.SecretRefs.SSHPasswordRef,
		host.Config.SecretRefs.KeyPassphraseRef,
		host.Config.SecretRefs.SudoPasswordRef,
	} {
		if strings.TrimSpace(ref) == "" {
			continue
		}
		if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			cleanupErrs = append(cleanupErrs, fmt.Sprintf("%s：%v", ref, err))
		}
	}
	if len(cleanupErrs) > 0 {
		return fmt.Errorf("host 已刪除，但 secret 清理失敗：%s", strings.Join(cleanupErrs, "；"))
	}

	log.WithField("hostId", hostID).Info("刪除 host 設定")
	return nil
}

func (s *Service) ListGroups(ctx context.Context) ([]dto.HostGroup, error) {
	return s.repo.ListGroups(ctx)
}

func (s *Service) SaveGroup(ctx context.Context, group dto.HostGroup) (dto.HostGroup, error) {
	group.ID = strings.TrimSpace(group.ID)
	if group.ID != "" {
		existing, err := s.repo.GetGroup(ctx, group.ID)
		if err == nil {
			group.CreatedAt = existing.CreatedAt
		}
	}

	normalized, err := normalizeGroup(group, s.now)
	if err != nil {
		return dto.HostGroup{}, err
	}

	// 巢狀目錄防呆：父目錄需存在，且不可指向自己或自身的子孫（避免循環）。
	if normalized.ParentID != "" {
		if normalized.ParentID == normalized.ID {
			return dto.HostGroup{}, errors.New("目錄不可設為自己的父目錄")
		}
		exists, err := s.repo.GroupExists(ctx, normalized.ParentID)
		if err != nil {
			return dto.HostGroup{}, err
		}
		if !exists {
			return dto.HostGroup{}, fmt.Errorf("父目錄不存在：%s", normalized.ParentID)
		}
		groups, err := s.repo.ListGroups(ctx)
		if err != nil {
			return dto.HostGroup{}, err
		}
		if isDescendantGroup(groups, normalized.ParentID, normalized.ID) {
			return dto.HostGroup{}, errors.New("不可將目錄移動到其子目錄底下")
		}
	}

	if err := s.repo.SaveGroup(ctx, normalized); err != nil {
		return dto.HostGroup{}, err
	}
	return normalized, nil
}

func (s *Service) DeleteGroup(ctx context.Context, groupID string) error {
	groupID = strings.TrimSpace(groupID)

	// 收集整個子樹（含自身）：連子目錄一起刪除，其下主機由 FK ON DELETE SET NULL 轉為未分組，
	// 整合設定與排除表由 FK ON DELETE CASCADE 自動清除，此處另清除 OS 憑證儲存區的 secret。
	groups, err := s.repo.ListGroups(ctx)
	if err != nil {
		return err
	}
	subtree := collectGroupSubtree(groups, groupID)

	for _, id := range subtree {
		ref := fmt.Sprintf("aws/%s/secret-access-key", id)
		if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			log.WithError(err).Warnf("刪除群組時，清除 AWS Secret 失敗：%s", ref)
		}
		gcpRef := fmt.Sprintf("gcp/%s/service-account-json", id)
		if err := s.secrets.DeleteSecret(ctx, gcpRef); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			log.WithError(err).Warnf("刪除群組時，清除 GCP Secret 失敗：%s", gcpRef)
		}
	}

	// 由子孫往上刪，最後刪除目標本身。
	for i := len(subtree) - 1; i >= 0; i-- {
		if err := s.repo.DeleteGroup(ctx, subtree[i]); err != nil {
			if subtree[i] == groupID {
				return err
			}
			log.WithError(err).Warnf("刪除子目錄失敗：%s", subtree[i])
		}
	}
	return nil
}

// collectGroupSubtree 以 BFS 回傳 root（含）之下所有群組 ID，順序為由淺至深。
func collectGroupSubtree(groups []dto.HostGroup, rootID string) []string {
	childrenOf := make(map[string][]string)
	for _, g := range groups {
		if g.ParentID != "" {
			childrenOf[g.ParentID] = append(childrenOf[g.ParentID], g.ID)
		}
	}
	ordered := []string{rootID}
	for i := 0; i < len(ordered); i++ {
		ordered = append(ordered, childrenOf[ordered[i]]...)
	}
	return ordered
}

// isDescendantGroup 判斷 candidateID 是否為 ancestorID 的子孫（用於避免目錄循環）。
func isDescendantGroup(groups []dto.HostGroup, candidateID string, ancestorID string) bool {
	parentOf := make(map[string]string)
	for _, g := range groups {
		parentOf[g.ID] = g.ParentID
	}
	for cur := candidateID; cur != ""; cur = parentOf[cur] {
		if cur == ancestorID {
			return true
		}
	}
	return false
}

func (s *Service) GetSettings(ctx context.Context) (dto.AppSettings, error) {
	return s.repo.LoadSettings(ctx)
}

func (s *Service) SaveSettings(ctx context.Context, settings dto.AppSettings) (dto.AppSettings, error) {
	if settings == nil {
		settings = dto.AppSettings{}
	}
	if err := s.repo.SaveSettings(ctx, settings); err != nil {
		return nil, err
	}
	return s.repo.LoadSettings(ctx)
}

func (s *Service) GetSnapshot(ctx context.Context) (dto.HostVaultSnapshot, error) {
	hosts, err := s.repo.ListHosts(ctx)
	if err != nil {
		return dto.HostVaultSnapshot{}, err
	}
	groups, err := s.repo.ListGroups(ctx)
	if err != nil {
		return dto.HostVaultSnapshot{}, err
	}
	settings, err := s.repo.LoadSettings(ctx)
	if err != nil {
		return dto.HostVaultSnapshot{}, err
	}
	return dto.HostVaultSnapshot{
		Hosts:    hosts,
		Groups:   groups,
		Settings: settings,
	}, nil
}

func (s *Service) GetSecretStatus(ctx context.Context, hostID string) (dto.HostSecretStatus, error) {
	host, err := s.repo.GetHost(ctx, hostID)
	if err != nil {
		return dto.HostSecretStatus{}, err
	}

	sshStatus, err := s.secretStatusEntry(ctx, host.Config.SecretRefs.SSHPasswordRef)
	if err != nil {
		return dto.HostSecretStatus{}, err
	}
	keyStatus, err := s.secretStatusEntry(ctx, host.Config.SecretRefs.KeyPassphraseRef)
	if err != nil {
		return dto.HostSecretStatus{}, err
	}
	sudoStatus, err := s.secretStatusEntry(ctx, host.Config.SecretRefs.SudoPasswordRef)
	if err != nil {
		return dto.HostSecretStatus{}, err
	}

	return dto.HostSecretStatus{
		HostID:         host.ID,
		SSHPassword:    sshStatus,
		KeyPassphrase:  keyStatus,
		SudoPassword:   sudoStatus,
		OverallHealthy: overallSecretHealth(host.Config.AuthMode, sshStatus, keyStatus, sudoStatus),
	}, nil
}

func (s *Service) GetSecretValue(ctx context.Context, request dto.HostSecretValueRequest) (dto.HostSecretValue, error) {
	hostID := strings.TrimSpace(request.HostID)
	field := strings.TrimSpace(request.Field)
	host, err := s.repo.GetHost(ctx, hostID)
	if err != nil {
		return dto.HostSecretValue{}, err
	}

	ref := ""
	switch field {
	case "sshPassword":
		ref = host.Config.SecretRefs.SSHPasswordRef
	case "keyPassphrase":
		ref = host.Config.SecretRefs.KeyPassphraseRef
	case "sudoPassword":
		ref = host.Config.SecretRefs.SudoPasswordRef
	default:
		return dto.HostSecretValue{}, fmt.Errorf("secret field 不支援：%s", field)
	}

	value, found, err := s.optionalSecret(ctx, ref)
	if err != nil {
		return dto.HostSecretValue{}, err
	}
	return dto.HostSecretValue{
		HostID: host.ID,
		Field:  field,
		Value:  value,
		Found:  found,
	}, nil
}

func (s *Service) ResolveRuntimeConfig(ctx context.Context, request dto.HostConnectionRequest) (dto.SSHConfig, error) {
	host, err := s.repo.GetHost(ctx, request.HostID)
	if err != nil {
		return dto.SSHConfig{}, err
	}

	config := dto.SSHConfig{
		Host:              host.Config.Host,
		Port:              host.Config.Port,
		Username:          host.Config.Username,
		AuthMode:          host.Config.AuthMode,
		PrivateKeyPath:    host.Config.PrivateKeyPath,
		CertPath:          host.Config.CertPath,
		SessionID:         strings.TrimSpace(request.SessionID),
		EnableCustomQuery: host.Config.EnableCustomQuery,
		CustomQueryScript: host.Config.CustomQueryScript,
	}

	switch host.Config.AuthMode {
	case constants.AuthModePassword:
		password, err := s.requireSecret(ctx, host.Config.SecretRefs.SSHPasswordRef, "SSH password")
		if err != nil {
			return dto.SSHConfig{}, err
		}
		config.Password = password
	case constants.AuthModeKey:
		passphrase, found, err := s.optionalSecret(ctx, host.Config.SecretRefs.KeyPassphraseRef)
		if err != nil {
			return dto.SSHConfig{}, err
		}
		if found {
			config.Password = passphrase
		}
		if keyID := strings.TrimSpace(host.Config.KeychainKeyID); keyID != "" {
			pem, err := s.keychain.GetPrivateKeyPEM(ctx, keyID)
			if err != nil {
				return dto.SSHConfig{}, fmt.Errorf("載入 Keychain 金鑰失敗：%w", err)
			}
			config.PrivateKeyData = pem
		}
	}

	sudoPassword, found, err := s.optionalSecret(ctx, host.Config.SecretRefs.SudoPasswordRef)
	if err != nil {
		return dto.SSHConfig{}, err
	}
	if found {
		config.SudoPassword = sudoPassword
	}

	return config, nil
}

func (s *Service) normalizeHost(input dto.HostProfile, existing dto.HostProfile, found bool) (dto.HostProfile, error) {
	host := input
	host.ID = strings.TrimSpace(host.ID)
	host.Label = strings.TrimSpace(host.Label)
	host.Alias = strings.TrimSpace(host.Alias)
	host.GroupID = strings.TrimSpace(host.GroupID)
	host.Config.Host = strings.TrimSpace(host.Config.Host)
	host.Config.Username = strings.TrimSpace(host.Config.Username)
	host.Config.AuthMode = strings.TrimSpace(host.Config.AuthMode)
	host.Config.PrivateKeyPath = strings.TrimSpace(host.Config.PrivateKeyPath)
	host.Config.KeychainKeyID = strings.TrimSpace(host.Config.KeychainKeyID)
	host.Config.CertPath = strings.TrimSpace(host.Config.CertPath)
	host.Config.StartupCommandMode = strings.TrimSpace(host.Config.StartupCommandMode)
	host.Config.StartupCommandText = strings.TrimSpace(host.Config.StartupCommandText)
	host.Config.CustomQueryScript = strings.TrimSpace(host.Config.CustomQueryScript)

	if host.ID == "" {
		host.ID = newID("h")
	}
	if host.Config.Host == "" {
		return dto.HostProfile{}, errors.New("host 不可空白")
	}
	if host.Config.Port == 0 {
		host.Config.Port = 22
	}
	if host.Config.Port < 1 || host.Config.Port > 65535 {
		return dto.HostProfile{}, errors.New("host port 必須介於 1 到 65535")
	}
	if host.Config.Username == "" {
		return dto.HostProfile{}, errors.New("host username 不可空白")
	}
	if host.Config.AuthMode != constants.AuthModePassword && host.Config.AuthMode != constants.AuthModeKey {
		return dto.HostProfile{}, errors.New("host authMode 必須是 key 或 password")
	}
	if host.Label == "" {
		if host.Alias != "" {
			host.Label = host.Alias
		} else {
			host.Label = fmt.Sprintf("%s@%s", host.Config.Username, host.Config.Host)
		}
	}
	if host.Config.StartupCommandMode == "" {
		host.Config.StartupCommandMode = "none"
	}
	if host.Config.StartupSnippetIDs == nil {
		host.Config.StartupSnippetIDs = []string{}
	}
	if host.Config.CustomComponents == nil {
		host.Config.CustomComponents = []dto.HostCustomComponent{}
	}

	if found {
		host.CreatedAt = existing.CreatedAt
		host.Config.SecretRefs = mergeSecretRefs(existing.Config.SecretRefs, host.Config.SecretRefs)
		// OSID 為連線時自動偵測的伺服器端欄位；未帶值時沿用既有值，
		// 避免前端一般編輯或 AWS 重新同步時被清空。
		if host.OSID == "" {
			host.OSID = existing.OSID
		}
	} else {
		host.CreatedAt = s.now().UTC().Format(time.RFC3339)
	}
	host.Config.SecretRefs = fillDefaultSecretRefs(host.ID, host.Config.SecretRefs)
	host.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	return host, nil
}

func (s *Service) getExistingHost(ctx context.Context, hostID string) (dto.HostProfile, bool, error) {
	hostID = strings.TrimSpace(hostID)
	if hostID == "" {
		return dto.HostProfile{}, false, nil
	}
	host, err := s.repo.GetHost(ctx, hostID)
	if err != nil {
		if errors.Is(err, storage.ErrHostNotFound) {
			return dto.HostProfile{}, false, nil
		}
		return dto.HostProfile{}, false, err
	}
	return host, true, nil
}

type rollbackFunc func(context.Context) error

func (s *Service) applySecretMutations(ctx context.Context, host dto.HostProfile, input dto.HostSecretsInput) (rollbackFunc, int, error) {
	rollbacks := make([]rollbackFunc, 0)
	secretWrites := 0

	apply := func(ref string, mutation dto.SecretValueInput, name string) error {
		ref = strings.TrimSpace(firstNonEmpty(mutation.Ref, ref))
		if ref == "" {
			return fmt.Errorf("%s secret ref 不可空白", name)
		}
		if mutation.Clear && mutation.HasValue {
			return fmt.Errorf("%s secret 不可同時要求 clear 與 set", name)
		}
		if mutation.Clear {
			prevValue, prevFound, err := s.optionalSecret(ctx, ref)
			if err != nil {
				return err
			}
			if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
				return err
			}
			rollbacks = append(rollbacks, func(ctx context.Context) error {
				if !prevFound {
					return nil
				}
				return s.secrets.SetSecret(ctx, ref, prevValue)
			})
			secretWrites++
			return nil
		}
		if !mutation.HasValue {
			return nil
		}

		prevValue, prevFound, err := s.optionalSecret(ctx, ref)
		if err != nil {
			return err
		}
		if err := s.secrets.SetSecret(ctx, ref, mutation.Value); err != nil {
			return err
		}
		rollbacks = append(rollbacks, func(ctx context.Context) error {
			if prevFound {
				return s.secrets.SetSecret(ctx, ref, prevValue)
			}
			err := s.secrets.DeleteSecret(ctx, ref)
			if errors.Is(err, secrets.ErrSecretNotFound) {
				return nil
			}
			return err
		})
		secretWrites++
		return nil
	}

	if err := apply(host.Config.SecretRefs.SSHPasswordRef, input.SSHPassword, "sshPassword"); err != nil {
		return nil, 0, err
	}
	if err := apply(host.Config.SecretRefs.KeyPassphraseRef, input.KeyPassphrase, "keyPassphrase"); err != nil {
		if rollbackErr := rollbackFuncs(ctx, rollbacks); rollbackErr != nil {
			return nil, 0, rollbackErr
		}
		return nil, 0, err
	}
	if err := apply(host.Config.SecretRefs.SudoPasswordRef, input.SudoPassword, "sudoPassword"); err != nil {
		if rollbackErr := rollbackFuncs(ctx, rollbacks); rollbackErr != nil {
			return nil, 0, rollbackErr
		}
		return nil, 0, err
	}

	return func(ctx context.Context) error {
		return rollbackFuncs(ctx, rollbacks)
	}, secretWrites, nil
}

func rollbackFuncs(ctx context.Context, rollbacks []rollbackFunc) error {
	for idx := len(rollbacks) - 1; idx >= 0; idx-- {
		if err := rollbacks[idx](ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) secretStatusEntry(ctx context.Context, ref string) (dto.SecretStatusEntry, error) {
	ref = strings.TrimSpace(ref)
	entry := dto.SecretStatusEntry{
		Ref:        ref,
		Configured: ref != "",
	}
	if ref == "" {
		return entry, nil
	}
	stored, err := s.secrets.HasSecret(ctx, ref)
	if err != nil {
		return dto.SecretStatusEntry{}, err
	}
	entry.Stored = stored
	if stored {
		value, found, err := s.optionalSecret(ctx, ref)
		if err != nil {
			return dto.SecretStatusEntry{}, err
		}
		if found {
			entry.Length = len([]rune(value))
		}
	}
	return entry, nil
}

func overallSecretHealth(authMode string, sshStatus dto.SecretStatusEntry, keyStatus dto.SecretStatusEntry, sudoStatus dto.SecretStatusEntry) bool {
	if authMode == constants.AuthModePassword && !sshStatus.Stored {
		return false
	}
	if authMode == constants.AuthModeKey && keyStatus.Configured && !keyStatus.Stored {
		return false
	}
	if sudoStatus.Configured && !sudoStatus.Stored {
		return false
	}
	return true
}

func (s *Service) requireSecret(ctx context.Context, ref string, label string) (string, error) {
	value, err := s.secrets.GetSecret(ctx, strings.TrimSpace(ref))
	if err != nil {
		if errors.Is(err, secrets.ErrSecretNotFound) {
			return "", fmt.Errorf("%s 尚未儲存於系統憑證儲存區", label)
		}
		return "", err
	}
	return value, nil
}

func (s *Service) optionalSecret(ctx context.Context, ref string) (string, bool, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", false, nil
	}
	value, err := s.secrets.GetSecret(ctx, ref)
	if err != nil {
		if errors.Is(err, secrets.ErrSecretNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	return value, true, nil
}

func normalizeGroup(group dto.HostGroup, now func() time.Time) (dto.HostGroup, error) {
	group.ID = strings.TrimSpace(group.ID)
	group.Name = strings.TrimSpace(group.Name)
	group.ParentID = strings.TrimSpace(group.ParentID)
	if group.ID == "" {
		group.ID = newID("g")
	}
	if group.Name == "" {
		return dto.HostGroup{}, errors.New("group name 不可空白")
	}
	if group.CreatedAt == "" {
		group.CreatedAt = now().UTC().Format(time.RFC3339)
	}
	group.UpdatedAt = now().UTC().Format(time.RFC3339)
	return group, nil
}

func mergeSecretRefs(existing dto.HostSecretRefs, next dto.HostSecretRefs) dto.HostSecretRefs {
	return dto.HostSecretRefs{
		SSHPasswordRef:   firstNonEmpty(next.SSHPasswordRef, existing.SSHPasswordRef),
		KeyPassphraseRef: firstNonEmpty(next.KeyPassphraseRef, existing.KeyPassphraseRef),
		SudoPasswordRef:  firstNonEmpty(next.SudoPasswordRef, existing.SudoPasswordRef),
	}
}

func fillDefaultSecretRefs(hostID string, refs dto.HostSecretRefs) dto.HostSecretRefs {
	hostID = strings.TrimSpace(hostID)
	if refs.SSHPasswordRef == "" {
		refs.SSHPasswordRef = fmt.Sprintf("host/%s/ssh-password", hostID)
	}
	if refs.KeyPassphraseRef == "" {
		refs.KeyPassphraseRef = fmt.Sprintf("host/%s/key-passphrase", hostID)
	}
	if refs.SudoPasswordRef == "" {
		refs.SudoPasswordRef = fmt.Sprintf("host/%s/sudo-password", hostID)
	}
	return refs
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func newID(prefix string) string {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	return fmt.Sprintf("%s_%d_%x", prefix, time.Now().UnixNano(), suffix[:])
}

func cloneSettings(input dto.AppSettings) dto.AppSettings {
	if input == nil {
		return dto.AppSettings{}
	}
	output := make(dto.AppSettings, len(input))
	for key, value := range input {
		cloned := make(json.RawMessage, len(value))
		copy(cloned, value)
		output[key] = cloned
	}
	return output
}
