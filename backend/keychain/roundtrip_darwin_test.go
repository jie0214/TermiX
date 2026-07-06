package keychain

import (
	"context"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/dto"

	cryptossh "golang.org/x/crypto/ssh"
)

// TestKeychainServiceRealStoreParsable 以真實 macOS Keychain 驗證：產生金鑰後，
// 取回的私鑰仍為可被 ssh.ParsePrivateKey 解析的 PEM（迴歸「ssh: no key found」）。
func TestKeychainServiceRealStoreParsable(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("僅在 macOS 驗證真實 Keychain")
	}
	if _, err := exec.LookPath("security"); err != nil {
		t.Skip("找不到 security 指令")
	}

	database, err := storage.OpenDatabase(filepath.Join(t.TempDir(), "termix.db"))
	if err != nil {
		t.Fatalf("OpenDatabase() error = %v", err)
	}
	store := secrets.NewKeychainStore("com.termix.test.kcparse")
	svc := NewService(storage.NewRepository(database), store)
	ctx := context.Background()

	for _, keyType := range []string{KeyTypeRSA, KeyTypeEd25519, KeyTypeECDSA} {
		key, err := svc.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "rt-" + keyType, Type: keyType})
		if err != nil {
			t.Fatalf("Generate(%s) error = %v", keyType, err)
		}
		t.Cleanup(func() { _ = svc.Delete(ctx, key.ID) })

		pem, err := svc.GetPrivateKeyPEM(ctx, key.ID)
		if err != nil {
			t.Fatalf("GetPrivateKeyPEM(%s) error = %v", keyType, err)
		}
		if _, err := cryptossh.ParsePrivateKey([]byte(pem)); err != nil {
			t.Errorf("ParsePrivateKey(%s) error = %v", keyType, err)
		}
	}
}
