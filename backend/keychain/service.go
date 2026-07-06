package keychain

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jie0214/TermiX/backend/common"
	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/dto"
)

var log = common.DomainLogger("keychain")

// Service 集中管理 SSH 金鑰：中繼資料存於 SQLite，私鑰內容存於 OS Credential Store。
type Service struct {
	repo    *storage.Repository
	secrets secrets.SecretStore
	now     func() time.Time
}

func NewService(repo *storage.Repository, secretStore secrets.SecretStore) *Service {
	return &Service{repo: repo, secrets: secretStore, now: time.Now}
}

func (s *Service) List(ctx context.Context) ([]dto.KeychainKey, error) {
	return s.repo.ListKeychainKeys(ctx)
}

func (s *Service) Generate(ctx context.Context, req dto.GenerateKeychainKeyRequest) (dto.KeychainKey, error) {
	label := strings.TrimSpace(req.Label)
	if label == "" {
		return dto.KeychainKey{}, errors.New("金鑰標籤不得為空")
	}
	comment := strings.TrimSpace(req.Comment)
	if comment == "" {
		comment = label
	}

	material, err := generateKeyMaterial(req.Type, req.Bits, comment, req.Passphrase)
	if err != nil {
		return dto.KeychainKey{}, err
	}
	return s.persist(ctx, label, comment, material)
}

func (s *Service) Import(ctx context.Context, req dto.ImportKeychainKeyRequest) (dto.KeychainKey, error) {
	label := strings.TrimSpace(req.Label)
	if label == "" {
		return dto.KeychainKey{}, errors.New("金鑰標籤不得為空")
	}
	if strings.TrimSpace(req.PrivateKey) == "" {
		return dto.KeychainKey{}, errors.New("私鑰內容不得為空")
	}
	comment := strings.TrimSpace(req.Comment)
	if comment == "" {
		comment = label
	}

	material, err := parseImportedKey(req.PrivateKey, req.Passphrase, comment)
	if err != nil {
		return dto.KeychainKey{}, err
	}
	return s.persist(ctx, label, comment, material)
}

// persist 將私鑰寫入 secret store，並把中繼資料寫入 SQLite；任一步失敗即回滾。
func (s *Service) persist(ctx context.Context, label, comment string, material keyMaterial) (dto.KeychainKey, error) {
	id := newID("key")
	ref := privateKeyRef(id)

	if err := s.secrets.SetSecret(ctx, ref, material.PrivatePEM); err != nil {
		return dto.KeychainKey{}, fmt.Errorf("儲存私鑰至憑證庫失敗：%w", err)
	}

	now := s.now().UTC().Format(time.RFC3339)
	key := dto.KeychainKey{
		ID:            id,
		Label:         label,
		Type:          material.Type,
		Bits:          material.Bits,
		PublicKey:     material.PublicKey,
		Fingerprint:   material.Fingerprint,
		Comment:       comment,
		HasPassphrase: material.HasPassphrase,
		PrivateKeyRef: ref,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := s.repo.SaveKeychainKey(ctx, key); err != nil {
		if delErr := s.secrets.DeleteSecret(ctx, ref); delErr != nil && !errors.Is(delErr, secrets.ErrSecretNotFound) {
			return dto.KeychainKey{}, fmt.Errorf("儲存金鑰中繼資料失敗且私鑰回滾失敗：%v；原始錯誤：%w", delErr, err)
		}
		return dto.KeychainKey{}, err
	}

	log.WithFields(map[string]any{
		"id":    id,
		"type":  key.Type,
		"label": label,
	}).Info("新增 keychain 金鑰")
	return key, nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	key, err := s.repo.GetKeychainKey(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteKeychainKey(ctx, id); err != nil {
		return err
	}
	if ref := strings.TrimSpace(key.PrivateKeyRef); ref != "" {
		if err := s.secrets.DeleteSecret(ctx, ref); err != nil && !errors.Is(err, secrets.ErrSecretNotFound) {
			log.WithError(err).Warnf("刪除 keychain 金鑰私鑰失敗：%s", ref)
		}
	}
	return nil
}

// GetPrivateKeyPEM 讀取指定金鑰的私鑰 PEM（維持其加密狀態），供主機連線時使用。
func (s *Service) GetPrivateKeyPEM(ctx context.Context, id string) (string, error) {
	key, err := s.repo.GetKeychainKey(ctx, id)
	if err != nil {
		return "", err
	}
	pem, err := s.secrets.GetSecret(ctx, key.PrivateKeyRef)
	if err != nil {
		return "", fmt.Errorf("讀取 keychain 私鑰失敗：%w", err)
	}
	return pem, nil
}

func (s *Service) Export(ctx context.Context, req dto.ExportKeychainKeyRequest) (dto.ExportedKeychainKey, error) {
	key, err := s.repo.GetKeychainKey(ctx, req.ID)
	if err != nil {
		return dto.ExportedKeychainKey{}, err
	}
	exported := dto.ExportedKeychainKey{
		Label:     key.Label,
		PublicKey: key.PublicKey,
	}
	if req.IncludePrivate {
		privatePEM, err := s.secrets.GetSecret(ctx, key.PrivateKeyRef)
		if err != nil {
			return dto.ExportedKeychainKey{}, fmt.Errorf("讀取私鑰失敗：%w", err)
		}
		exported.PrivateKey = privatePEM
	}
	return exported, nil
}

func privateKeyRef(id string) string {
	return "keychain/" + id + "/private"
}

func newID(prefix string) string {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	return fmt.Sprintf("%s_%d_%x", prefix, time.Now().UnixNano(), suffix[:])
}
