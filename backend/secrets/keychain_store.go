package secrets

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// keychainValuePrefix 標記以 base64 編碼儲存的值。macOS 的
// `security find-generic-password -w` 在讀取含換行的多行內容時會改以 hex 輸出，
// 導致多行秘密（例如 OpenSSH 私鑰）取回後損毀。寫入前一律 base64（單行純 ASCII）
// 可避開此行為；讀取時依前綴解碼，未帶前綴者視為舊版明文原樣回傳。
const keychainValuePrefix = "b64:"

type KeychainStore struct {
	service string
}

func NewKeychainStore(service string) *KeychainStore {
	return &KeychainStore{
		service: strings.TrimSpace(service),
	}
}

func (k *KeychainStore) SetSecret(ctx context.Context, ref string, value string) error {
	ref = normalizeRef(ref)
	if ref == "" {
		return errors.New("secret ref 不可空白")
	}
	// 明確拒絕空值：若把 -w 傳入空字串，security 會誤判為要求互動式輸入而阻塞讀 tty，
	// 在 GUI（無 tty）情境會 hang；同時空值本身無寫入意義。
	if value == "" {
		return errors.New("secret 值不可空白")
	}
	// 安全備註（M-1，殘留風險）：macOS 的 `security add-generic-password` 只能透過
	// -w 旗標由命令列參數帶入秘密值，該工具並無以 stdin 管線輸入密碼的機制（-w 不帶
	// 值時只會從控制終端互動讀取，GUI 無 tty 無法使用）。因此在寫入的短暫瞬間，同一
	// 使用者可透過 `ps` 觀察到明文。要徹底消除此暴露需改用原生 Keychain API 的 Go
	// 函式庫，惟本次修補環境無 Go 編譯器、無法驗證新增依賴是否破壞建置，依保守原則
	// 暫不引入未經編譯驗證的第三方相依，改以文件化殘留風險並待本機驗證後再行升級。
	encoded := keychainValuePrefix + base64.StdEncoding.EncodeToString([]byte(value))
	cmd := exec.CommandContext(ctx, "security", "add-generic-password", "-U", "-a", ref, "-s", k.service, "-w", encoded)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("寫入 macOS Keychain 失敗：%w，輸出：%s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (k *KeychainStore) GetSecret(ctx context.Context, ref string) (string, error) {
	ref = normalizeRef(ref)
	if ref == "" {
		return "", errors.New("secret ref 不可空白")
	}
	cmd := exec.CommandContext(ctx, "security", "find-generic-password", "-a", ref, "-s", k.service, "-w")
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if isKeychainNotFound(stderr.String()) {
			return "", ErrSecretNotFound
		}
		return "", fmt.Errorf("讀取 macOS Keychain 失敗：%w，輸出：%s", err, strings.TrimSpace(stderr.String()))
	}
	return decodeKeychainValue(strings.TrimRight(stdout.String(), "\n")), nil
}

// decodeKeychainValue 還原 security 讀出的值：
//  1. 若為 hex（security 對含換行的多行舊值會如此輸出）且還原後是 PEM 或帶本前綴，採用還原結果；
//  2. 若帶 base64 前綴則解碼；
//  3. 其餘視為舊版單行明文，原樣回傳。
func decodeKeychainValue(raw string) string {
	if looksLikeHex(raw) {
		if decoded, err := hex.DecodeString(raw); err == nil {
			s := string(decoded)
			if strings.HasPrefix(s, keychainValuePrefix) || strings.Contains(s, "PRIVATE KEY-----") {
				raw = s
			}
		}
	}
	if strings.HasPrefix(raw, keychainValuePrefix) {
		if decoded, err := base64.StdEncoding.DecodeString(raw[len(keychainValuePrefix):]); err == nil {
			return string(decoded)
		}
	}
	return raw
}

// looksLikeHex 判斷字串是否為偶數長度且全為十六進位字元。
func looksLikeHex(s string) bool {
	if len(s) == 0 || len(s)%2 != 0 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func (k *KeychainStore) DeleteSecret(ctx context.Context, ref string) error {
	ref = normalizeRef(ref)
	if ref == "" {
		return errors.New("secret ref 不可空白")
	}
	cmd := exec.CommandContext(ctx, "security", "delete-generic-password", "-a", ref, "-s", k.service)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if isKeychainNotFound(string(output)) {
			return ErrSecretNotFound
		}
		return fmt.Errorf("刪除 macOS Keychain 失敗：%w，輸出：%s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (k *KeychainStore) HasSecret(ctx context.Context, ref string) (bool, error) {
	_, err := k.GetSecret(ctx, ref)
	if err == nil {
		return true, nil
	}
	if err == ErrSecretNotFound {
		return false, nil
	}
	return false, err
}

func isKeychainNotFound(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "could not be found") || strings.Contains(lower, "item not found")
}

var _ SecretStore = (*KeychainStore)(nil)
