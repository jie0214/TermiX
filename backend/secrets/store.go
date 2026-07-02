package secrets

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"

	"github.com/jie0214/TermiX/backend/common"
)

var log = common.DomainLogger("secrets")

var ErrSecretNotFound = errors.New("secret 不存在")

type SecretStore interface {
	SetSecret(ctx context.Context, ref string, value string) error
	GetSecret(ctx context.Context, ref string) (string, error)
	DeleteSecret(ctx context.Context, ref string) error
	HasSecret(ctx context.Context, ref string) (bool, error)
}

func NewSecretStore() SecretStore {
	if forceMemoryStore() {
		log.Warn("使用記憶體 secret store fallback")
		return NewMemoryStore()
	}
	if runtime.GOOS == "darwin" {
		if _, err := exec.LookPath("security"); err == nil {
			log.Info("使用 macOS Keychain secret store")
			return NewKeychainStore("com.termix.hostvault")
		} else {
			log.WithError(err).Warn("找不到 macOS security 指令，改用記憶體 secret store fallback")
		}
		return NewMemoryStore()
	}
	log.WithField("goos", runtime.GOOS).Warn("目前平台未實作 OS Credential Store，改用記憶體 secret store fallback")
	return NewMemoryStore()
}

func normalizeRef(ref string) string {
	return strings.TrimSpace(ref)
}

func forceMemoryStore() bool {
	return strings.EqualFold(strings.TrimSpace(getEnv("TERMIX_SECRET_STORE")), "memory")
}

var getEnv = func(key string) string {
	return ""
}
