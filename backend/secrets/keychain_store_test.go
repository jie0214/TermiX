package secrets

import (
	"context"
	"encoding/hex"
	"os/exec"
	"runtime"
	"testing"
)

func TestDecodeKeychainValue(t *testing.T) {
	if got := decodeKeychainValue("plain-legacy"); got != "plain-legacy" {
		t.Errorf("legacy value = %q, want passthrough", got)
	}
	if got := decodeKeychainValue("b64:aGVsbG8="); got != "hello" {
		t.Errorf("decoded value = %q, want hello", got)
	}
	if got := decodeKeychainValue("b64:not-base64!!"); got != "b64:not-base64!!" {
		t.Errorf("invalid base64 = %q, want passthrough", got)
	}
	// 舊版多行 PEM 被 security 以 hex 輸出時，應能還原成原始 PEM。
	pem := "-----BEGIN OPENSSH PRIVATE KEY-----\nabcd\n-----END OPENSSH PRIVATE KEY-----"
	hexed := hex.EncodeToString([]byte(pem))
	if got := decodeKeychainValue(hexed); got != pem {
		t.Errorf("hex-encoded PEM not recovered:\n got = %q", got)
	}
	// 恰為 hex 外觀的舊版明文密碼不得被誤解碼。
	if got := decodeKeychainValue("deadbeef"); got != "deadbeef" {
		t.Errorf("hex-looking legacy password = %q, want passthrough", got)
	}
}

// TestKeychainStoreMultilineRoundTrip 驗證多行秘密（如 OpenSSH 私鑰）經由 macOS
// security CLI 存取後內容不變，涵蓋先前多行值被 hex 化損毀的迴歸。
func TestKeychainStoreMultilineRoundTrip(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("僅在 macOS 驗證 security CLI")
	}
	if _, err := exec.LookPath("security"); err != nil {
		t.Skip("找不到 security 指令")
	}

	store := NewKeychainStore("com.termix.test.roundtrip")
	ctx := context.Background()
	ref := "keychain/test-roundtrip/private"
	pem := "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAABAAAA\n-----END OPENSSH PRIVATE KEY-----\n"

	if err := store.SetSecret(ctx, ref, pem); err != nil {
		t.Fatalf("SetSecret() error = %v", err)
	}
	t.Cleanup(func() { _ = store.DeleteSecret(ctx, ref) })

	got, err := store.GetSecret(ctx, ref)
	if err != nil {
		t.Fatalf("GetSecret() error = %v", err)
	}
	if got != pem {
		t.Errorf("round-trip mismatch:\n got = %q\nwant = %q", got, pem)
	}
}
