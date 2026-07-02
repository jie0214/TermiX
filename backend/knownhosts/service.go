package knownhosts

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"go.uber.org/fx"
	"golang.org/x/crypto/ssh"
	cryptoknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

// Module 暴露 knownhosts 領域模組的 Fx 提供者
var Module = fx.Options(
	fx.Provide(NewValidator),
)

// UnknownHostErrorPrefix 是未知主機錯誤訊息的固定前綴，供上層（含前端）辨識。
// 完整訊息格式為： "<prefix>: <hostname> (SHA256:....)"
const UnknownHostErrorPrefix = "UNKNOWN_HOST_KEY"

// UnknownHostKeyError 代表遇到「尚未被信任的未知主機」。
// 它不會自動寫入 known_hosts，而是中斷連線，等待使用者明確確認。
type UnknownHostKeyError struct {
	// Hostname 為 crypto/ssh 回呼傳入的主機識別字串（通常為 host:port 形式），
	// 後續 Trust / ConfirmHostKey 需以相同字串作為鍵。
	Hostname string
	// Fingerprint 為該主機公鑰的 SHA256 指紋（ssh.FingerprintSHA256 格式）。
	Fingerprint string
}

// Error 回傳固定前綴 + 主機與指紋，方便上層以字串前綴辨識並解析指紋。
func (e *UnknownHostKeyError) Error() string {
	return fmt.Sprintf("%s: %s (%s)", UnknownHostErrorPrefix, e.Hostname, e.Fingerprint)
}

// pendingKey 暫存等待使用者確認的未知主機公鑰與其對應的 known_hosts 路徑。
type pendingKey struct {
	key            ssh.PublicKey
	knownHostsPath string
}

// Validator 負責處理 SSH 主機 Key 的比對與 known_hosts 檔案安全校驗
type Validator struct {
	mu      sync.Mutex
	pending map[string]pendingKey
}

// NewValidator 建立 Validator 實例
func NewValidator() *Validator {
	return &Validator{
		pending: make(map[string]pendingKey),
	}
}

// GetHostKeyCallback 載入實體 known_hosts 檔案並返回 HostKey 驗證回呼
func (v *Validator) GetHostKeyCallback() (ssh.HostKeyCallback, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("無法取得使用者家目錄：%w", err)
	}

	sshDir := filepath.Join(home, ".ssh")
	knownHostsPath := filepath.Join(sshDir, "known_hosts")

	// 確保 .ssh 目錄存在
	if err := os.MkdirAll(sshDir, 0700); err != nil {
		return nil, fmt.Errorf("無法建立 .ssh 目錄：%w", err)
	}

	// 確保 known_hosts 檔案存在，若不存在則建立空檔案
	if _, err := os.Stat(knownHostsPath); os.IsNotExist(err) {
		file, err := os.OpenFile(knownHostsPath, os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return nil, fmt.Errorf("無法建立 known_hosts 檔案：%w", err)
		}
		_ = file.Close()
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		// 1. 建立標準的 cryptoknownhosts 驗證器，實時載入檔案
		callback, err := cryptoknownhosts.New(knownHostsPath)
		if err != nil {
			return fmt.Errorf("載入 known_hosts 失敗：%w", err)
		}

		// 2. 進行校驗
		verifyErr := callback(hostname, remote, key)
		if verifyErr == nil {
			return nil // 校驗通過
		}

		// 3. 處理校驗失敗
		// 藉由類型斷言 golang.org/x/crypto/ssh/knownhosts.KeyError 解析錯誤
		if keyErr, ok := verifyErr.(*cryptoknownhosts.KeyError); ok {
			if len(keyErr.Want) > 0 {
				// Want 條目不為空，說明是主機金鑰已變更 (Mismatch)，必須拒絕以防 MITM
				return verifyErr
			}

			// Want 條目為空，說明是未知主機 (Key is unknown)。
			// 嚴禁盲目 TOFU 自動寫入：改為計算指紋、暫存待確認的公鑰，並中斷連線，
			// 由使用者透過 Trust / ConfirmHostKey 明確確認後才寫入 known_hosts（符合 SKILL.md §5.1）。
			fingerprint := ssh.FingerprintSHA256(key)

			v.mu.Lock()
			v.pending[hostname] = pendingKey{
				key:            key,
				knownHostsPath: knownHostsPath,
			}
			v.mu.Unlock()

			return &UnknownHostKeyError{
				Hostname:    hostname,
				Fingerprint: fingerprint,
			}
		}

		// 其他非 KeyError (如檔案 I/O 錯誤等)，直接返回原錯
		return verifyErr
	}, nil
}

// Trust 在使用者明確確認後，將先前暫存的未知主機公鑰寫入 known_hosts。
// hostname 必須與 UnknownHostKeyError.Hostname（即 crypto/ssh 回呼傳入的字串）一致。
// 若無對應的待確認條目，回傳錯誤。寫入沿用既有的 0600 權限與追加邏輯。
func (v *Validator) Trust(hostname string) error {
	v.mu.Lock()
	entry, ok := v.pending[hostname]
	v.mu.Unlock()
	if !ok {
		return fmt.Errorf("找不到待確認的未知主機條目：%s", hostname)
	}

	line := cryptoknownhosts.Line([]string{hostname}, entry.key)

	f, err := os.OpenFile(entry.knownHostsPath, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("無法將未知主機寫入 known_hosts：%w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(line + "\n"); err != nil {
		return fmt.Errorf("無法寫入未知主機指紋：%w", err)
	}

	// 寫入成功後移除暫存條目，避免記憶體累積與重複寫入。
	v.mu.Lock()
	delete(v.pending, hostname)
	v.mu.Unlock()

	return nil
}

// RemoveHost 透過 ssh-keygen 撤銷對指定主機指紋的信任，支援帶 port 的條目清除
func (v *Validator) RemoveHost(host string, port int) error {
	// 清除基本主機名條目 (例如 IP)
	cmd := exec.Command("ssh-keygen", "-R", host)
	_ = cmd.Run()

	// 若為非標準 port，清除帶有中括號與 port 的條目 (例如 [192.168.1.1]:2222)
	if port != 22 && port > 0 {
		addrWithPort := fmt.Sprintf("[%s]:%d", host, port)
		cmdWithPort := exec.Command("ssh-keygen", "-R", addrWithPort)
		_ = cmdWithPort.Run()
	}
	return nil
}
