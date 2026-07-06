package keychain

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/dto"
)

func newTestService(t *testing.T) (*Service, secrets.SecretStore) {
	t.Helper()
	database, err := storage.OpenDatabase(filepath.Join(t.TempDir(), "termix.db"))
	if err != nil {
		t.Fatalf("OpenDatabase() error = %v", err)
	}
	store := secrets.NewMemoryStore()
	return NewService(storage.NewRepository(database), store), store
}

func TestGenerateAndList(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()

	key, err := svc.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "ci-key", Type: KeyTypeEd25519})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if key.Type != KeyTypeEd25519 {
		t.Errorf("Type = %q, want ed25519", key.Type)
	}
	if !strings.HasPrefix(key.Fingerprint, "SHA256:") {
		t.Errorf("Fingerprint = %q, want SHA256 prefix", key.Fingerprint)
	}
	if !strings.HasPrefix(key.PublicKey, "ssh-ed25519 ") {
		t.Errorf("PublicKey = %q, want ssh-ed25519 prefix", key.PublicKey)
	}
	if key.HasPassphrase {
		t.Error("HasPassphrase = true, want false for keyless generation")
	}

	// 私鑰內容應存在 secret store，且不在中繼資料表。
	stored, err := store.GetSecret(ctx, key.PrivateKeyRef)
	if err != nil {
		t.Fatalf("GetSecret() error = %v", err)
	}
	if !strings.Contains(stored, "OPENSSH PRIVATE KEY") {
		t.Errorf("stored private key not OpenSSH format: %q", stored)
	}

	list, err := svc.List(ctx)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(list) != 1 || list[0].ID != key.ID {
		t.Fatalf("List() = %+v, want single key %s", list, key.ID)
	}
}

func TestGenerateRSAAndECDSANormalizeBits(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	rsaKey, err := svc.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "rsa", Type: KeyTypeRSA})
	if err != nil {
		t.Fatalf("Generate(rsa) error = %v", err)
	}
	if rsaKey.Bits != defaultRSABits {
		t.Errorf("rsa bits = %d, want %d", rsaKey.Bits, defaultRSABits)
	}

	ecKey, err := svc.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "ec", Type: KeyTypeECDSA, Bits: 384})
	if err != nil {
		t.Fatalf("Generate(ecdsa) error = %v", err)
	}
	if ecKey.Bits != 384 {
		t.Errorf("ecdsa bits = %d, want 384", ecKey.Bits)
	}
}

func TestGenerateWithPassphraseEncryptsPrivateKey(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	key, err := svc.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "locked", Type: KeyTypeEd25519, Passphrase: "s3cret"})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if !key.HasPassphrase {
		t.Error("HasPassphrase = false, want true")
	}

	exported, err := svc.Export(ctx, dto.ExportKeychainKeyRequest{ID: key.ID, IncludePrivate: true})
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	// 匯出的私鑰應維持加密狀態：無密碼短語解析應回傳 PassphraseMissingError。
	if _, err := parseImportedKey(exported.PrivateKey, "", ""); err == nil {
		t.Error("parse without passphrase succeeded, want error for encrypted key")
	}
	if _, err := parseImportedKey(exported.PrivateKey, "s3cret", ""); err != nil {
		t.Errorf("parse with correct passphrase error = %v", err)
	}
}

func TestImportRoundTrip(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	// 先產生一把明文私鑰作為匯入來源。
	material, err := generateKeyMaterial(KeyTypeRSA, minRSABits, "seed", "")
	if err != nil {
		t.Fatalf("generateKeyMaterial() error = %v", err)
	}

	imported, err := svc.Import(ctx, dto.ImportKeychainKeyRequest{Label: "imported", PrivateKey: material.PrivatePEM})
	if err != nil {
		t.Fatalf("Import() error = %v", err)
	}
	if imported.Type != KeyTypeRSA {
		t.Errorf("Type = %q, want rsa", imported.Type)
	}
	if imported.Fingerprint != material.Fingerprint {
		t.Errorf("Fingerprint = %q, want %q", imported.Fingerprint, material.Fingerprint)
	}
	if imported.HasPassphrase {
		t.Error("HasPassphrase = true, want false for plaintext import")
	}
}

func TestImportEncryptedRequiresPassphrase(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	material, err := generateKeyMaterial(KeyTypeEd25519, 0, "seed", "pw123")
	if err != nil {
		t.Fatalf("generateKeyMaterial() error = %v", err)
	}

	if _, err := svc.Import(ctx, dto.ImportKeychainKeyRequest{Label: "x", PrivateKey: material.PrivatePEM}); err == nil {
		t.Error("Import without passphrase succeeded, want error")
	}

	imported, err := svc.Import(ctx, dto.ImportKeychainKeyRequest{Label: "x", PrivateKey: material.PrivatePEM, Passphrase: "pw123"})
	if err != nil {
		t.Fatalf("Import with passphrase error = %v", err)
	}
	if !imported.HasPassphrase {
		t.Error("HasPassphrase = false, want true for encrypted import")
	}
}

func TestDeleteRemovesMetadataAndSecret(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()

	key, err := svc.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "temp", Type: KeyTypeEd25519})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if err := svc.Delete(ctx, key.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	list, err := svc.List(ctx)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(list) != 0 {
		t.Errorf("List() len = %d, want 0", len(list))
	}
	if has, _ := store.HasSecret(ctx, key.PrivateKeyRef); has {
		t.Error("private key secret still present after delete")
	}
}
