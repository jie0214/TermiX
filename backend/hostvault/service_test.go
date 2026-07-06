package hostvault

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"
)

func TestServiceSaveResolveAndExportHost(t *testing.T) {
	svc := newTestService(t, secrets.NewMemoryStore())
	ctx := context.Background()

	if _, err := svc.SaveGroup(ctx, dto.HostGroup{
		ID:   "group-1",
		Name: "Production",
	}); err != nil {
		t.Fatalf("SaveGroup() error = %v", err)
	}

	saved, secretWrites, err := svc.SaveHost(ctx, dto.SaveHostRequest{
		Host: dto.HostProfile{
			ID:      "host-1",
			Alias:   "prod-1",
			GroupID: "group-1",
			Config: dto.PersistedHostConfig{
				Host:                       "10.0.0.1",
				Port:                       22,
				Username:                   "root",
				AuthMode:                   constants.AuthModePassword,
				ShowSnippetsInControlPanel: true,
				StartupSnippetIDs:          []string{"snippet-1"},
				StartupCommandMode:         "snippet",
			},
		},
		Secrets: dto.HostSecretsInput{
			SSHPassword: dto.SecretValueInput{
				Value:    "ssh-secret",
				HasValue: true,
			},
			SudoPassword: dto.SecretValueInput{
				Value:    "sudo-secret",
				HasValue: true,
			},
		},
	})
	if err != nil {
		t.Fatalf("SaveHost() error = %v", err)
	}
	if secretWrites != 2 {
		t.Fatalf("SaveHost() secretWrites = %d, want 2", secretWrites)
	}
	if saved.Config.SecretRefs.SSHPasswordRef == "" || saved.Config.SecretRefs.SudoPasswordRef == "" {
		t.Fatalf("SaveHost() 未生成 secret refs：%+v", saved.Config.SecretRefs)
	}

	hosts, err := svc.ListHosts(ctx)
	if err != nil {
		t.Fatalf("ListHosts() error = %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("ListHosts() len = %d, want 1", len(hosts))
	}

	status, err := svc.GetSecretStatus(ctx, "host-1")
	if err != nil {
		t.Fatalf("GetSecretStatus() error = %v", err)
	}
	if !status.OverallHealthy || !status.SSHPassword.Stored || !status.SudoPassword.Stored {
		t.Fatalf("GetSecretStatus() = %+v, want healthy stored secrets", status)
	}
	if status.SSHPassword.Length != len([]rune("ssh-secret")) || status.SudoPassword.Length != len([]rune("sudo-secret")) {
		t.Fatalf("GetSecretStatus() secret length = ssh:%d sudo:%d, want ssh:%d sudo:%d",
			status.SSHPassword.Length,
			status.SudoPassword.Length,
			len([]rune("ssh-secret")),
			len([]rune("sudo-secret")),
		)
	}

	secretValue, err := svc.GetSecretValue(ctx, dto.HostSecretValueRequest{
		HostID: "host-1",
		Field:  "sudoPassword",
	})
	if err != nil {
		t.Fatalf("GetSecretValue() error = %v", err)
	}
	if !secretValue.Found || secretValue.Value != "sudo-secret" {
		t.Fatalf("GetSecretValue() = %+v, want sudo-secret", secretValue)
	}
	if _, err := svc.GetSecretValue(ctx, dto.HostSecretValueRequest{
		HostID: "host-1",
		Field:  "unknown",
	}); err == nil {
		t.Fatalf("GetSecretValue() unknown field expected error, got nil")
	}

	runtimeConfig, err := svc.ResolveRuntimeConfig(ctx, dto.HostConnectionRequest{
		HostID:    "host-1",
		SessionID: "sess-1",
	})
	if err != nil {
		t.Fatalf("ResolveRuntimeConfig() error = %v", err)
	}
	if runtimeConfig.Password != "ssh-secret" || runtimeConfig.SudoPassword != "sudo-secret" {
		t.Fatalf("ResolveRuntimeConfig() secrets mismatch: %+v", runtimeConfig)
	}
	if runtimeConfig.SessionID != "sess-1" {
		t.Fatalf("ResolveRuntimeConfig() sessionId = %q, want sess-1", runtimeConfig.SessionID)
	}

	exported, err := svc.Export(ctx, dto.HostExportOptions{Format: "json", Mode: "reference"})
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	if !strings.Contains(exported, `"sshPasswordRef"`) {
		t.Fatalf("Export() missing sshPasswordRef: %s", exported)
	}
	if strings.Contains(exported, "ssh-secret") || strings.Contains(exported, "sudo-secret") {
		t.Fatalf("Export() leaked secret values: %s", exported)
	}
}

func TestServiceSaveHostRollsBackSecretsOnFailure(t *testing.T) {
	failingStore := &failingSecretStore{
		MemoryStore: secrets.NewMemoryStore(),
		failOnSet: map[string]error{
			"host/host-rollback/sudo-password": errors.New("boom"),
		},
	}
	svc := newTestService(t, failingStore)
	ctx := context.Background()

	_, _, err := svc.SaveHost(ctx, dto.SaveHostRequest{
		Host: dto.HostProfile{
			ID:    "host-rollback",
			Alias: "rollback",
			Config: dto.PersistedHostConfig{
				Host:     "10.0.0.2",
				Port:     22,
				Username: "root",
				AuthMode: constants.AuthModePassword,
			},
		},
		Secrets: dto.HostSecretsInput{
			SSHPassword: dto.SecretValueInput{
				Value:    "first-secret",
				HasValue: true,
			},
			SudoPassword: dto.SecretValueInput{
				Value:    "second-secret",
				HasValue: true,
			},
		},
	})
	if err == nil {
		t.Fatalf("SaveHost() expected error, got nil")
	}

	hosts, listErr := svc.ListHosts(ctx)
	if listErr != nil {
		t.Fatalf("ListHosts() error = %v", listErr)
	}
	if len(hosts) != 0 {
		t.Fatalf("ListHosts() len = %d, want 0 after rollback", len(hosts))
	}

	if _, err := failingStore.GetSecret(ctx, "host/host-rollback/ssh-password"); !errors.Is(err, secrets.ErrSecretNotFound) {
		t.Fatalf("ssh-password secret should be rolled back, got err=%v", err)
	}
}

func TestServiceImportModesControlSecretWrites(t *testing.T) {
	ctx := context.Background()
	payload := `{
		"hosts": [
			{
				"id": "legacy-host",
				"alias": "legacy",
				"config": {
					"host": "10.0.0.3",
					"port": 22,
					"username": "root",
					"authMode": "password",
					"password": "legacy-secret",
					"sudoPassword": "legacy-sudo"
				}
			}
		]
	}`

	referenceOnlyStore := secrets.NewMemoryStore()
	referenceOnlySvc := newTestService(t, referenceOnlyStore)
	referenceOnlyResult, err := referenceOnlySvc.Import(ctx, payload, dto.HostImportOptions{Format: "json", Mode: "reference-only"})
	if err != nil {
		t.Fatalf("Import(reference-only) error = %v", err)
	}
	if referenceOnlyResult.SecretsWritten != 0 {
		t.Fatalf("Import(reference-only) secretsWritten = %d, want 0", referenceOnlyResult.SecretsWritten)
	}
	if _, err := referenceOnlyStore.GetSecret(ctx, "host/legacy-host/ssh-password"); !errors.Is(err, secrets.ErrSecretNotFound) {
		t.Fatalf("reference-only should not write ssh secret, err=%v", err)
	}

	refSecretStore := secrets.NewMemoryStore()
	refSecretSvc := newTestService(t, refSecretStore)
	refSecretResult, err := refSecretSvc.Import(ctx, payload, dto.HostImportOptions{Format: "json", Mode: "reference+secret"})
	if err != nil {
		t.Fatalf("Import(reference+secret) error = %v", err)
	}
	if refSecretResult.SecretsWritten != 2 {
		t.Fatalf("Import(reference+secret) secretsWritten = %d, want 2", refSecretResult.SecretsWritten)
	}
	sshSecret, err := refSecretStore.GetSecret(ctx, "host/legacy-host/ssh-password")
	if err != nil {
		t.Fatalf("reference+secret ssh secret missing: %v", err)
	}
	if sshSecret != "legacy-secret" {
		t.Fatalf("reference+secret ssh secret = %q, want legacy-secret", sshSecret)
	}
}

func TestServiceImportDropsMissingGroupReference(t *testing.T) {
	svc := newTestService(t, secrets.NewMemoryStore())
	ctx := context.Background()
	payload := `{
		"hosts": [
			{
				"id": "orphan-host",
				"alias": "orphan",
				"groupId": "missing-group",
				"config": {
					"host": "10.0.0.4",
					"port": 22,
					"username": "root",
					"authMode": "password"
				}
			}
		]
	}`

	result, err := svc.Import(ctx, payload, dto.HostImportOptions{Format: "json", Mode: "reference-only"})
	if err != nil {
		t.Fatalf("Import() error = %v", err)
	}
	if len(result.Warnings) != 1 {
		t.Fatalf("Import() warnings len = %d, want 1: %+v", len(result.Warnings), result.Warnings)
	}
	host, err := svc.GetHost(ctx, "orphan-host")
	if err != nil {
		t.Fatalf("GetHost() error = %v", err)
	}
	if host.GroupID != "" {
		t.Fatalf("GetHost() groupId = %q, want empty", host.GroupID)
	}
}

func newTestService(t *testing.T, secretStore secrets.SecretStore) *Service {
	t.Helper()

	database, err := storage.OpenDatabase(filepath.Join(t.TempDir(), "termix.db"))
	if err != nil {
		t.Fatalf("OpenDatabase() error = %v", err)
	}

	return newServiceForTest(
		storage.NewRepository(database),
		secretStore,
		func() time.Time {
			return time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
		},
	)
}

type failingSecretStore struct {
	*secrets.MemoryStore
	failOnSet map[string]error
}

func (f *failingSecretStore) SetSecret(ctx context.Context, ref string, value string) error {
	if err, ok := f.failOnSet[ref]; ok {
		return err
	}
	return f.MemoryStore.SetSecret(ctx, ref, value)
}

func TestResolveRuntimeConfigInjectsKeychainPrivateKey(t *testing.T) {
	svc := newTestService(t, secrets.NewMemoryStore())
	ctx := context.Background()

	key, err := svc.keychain.Generate(ctx, dto.GenerateKeychainKeyRequest{Label: "host-key", Type: "ed25519"})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if _, _, err := svc.SaveHost(ctx, dto.SaveHostRequest{
		Host: dto.HostProfile{
			ID:    "host-kc",
			Alias: "kc",
			Config: dto.PersistedHostConfig{
				Host:          "10.0.0.9",
				Port:          22,
				Username:      "root",
				AuthMode:      constants.AuthModeKey,
				KeychainKeyID: key.ID,
			},
		},
	}); err != nil {
		t.Fatalf("SaveHost() error = %v", err)
	}

	config, err := svc.ResolveRuntimeConfig(ctx, dto.HostConnectionRequest{HostID: "host-kc"})
	if err != nil {
		t.Fatalf("ResolveRuntimeConfig() error = %v", err)
	}
	if !strings.Contains(config.PrivateKeyData, "OPENSSH PRIVATE KEY") {
		t.Fatalf("PrivateKeyData 未注入 keychain 私鑰：%q", config.PrivateKeyData)
	}
}
