package ssh

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"github.com/jie0214/TermiX/backend/common"
	"github.com/jie0214/TermiX/backend/knownhosts"
	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"
	"strconv"
	"strings"
	"time"

	"go.uber.org/fx"
	cryptossh "golang.org/x/crypto/ssh"
)

// Module 暴露 ssh 領域模組的 Fx 提供者
var Module = fx.Options(
	fx.Provide(NewConnector),
)

// Connector 專責處理安全 SSH 連線的建立與認證
type Connector struct {
	knownHosts *knownhosts.Validator
}

// NewConnector 建立 SSH 連線器實例
func NewConnector(kh *knownhosts.Validator) *Connector {
	return &Connector{
		knownHosts: kh,
	}
}

// RemoveKnownHost 撤銷對指定主機的 Key 指紋信任
func (c *Connector) RemoveKnownHost(host string, port int) error {
	return c.knownHosts.RemoveHost(host, port)
}

// ConfirmUnknownHost 在使用者確認指紋後，將先前暫存的未知主機公鑰寫入 known_hosts。
// host 與 port 會被組合成與 SSH 連線時相同的位址字串（net.JoinHostPort），
// 以對應 HostKeyCallback 暫存時所使用的鍵。
func (c *Connector) ConfirmUnknownHost(host string, port int) error {
	address := net.JoinHostPort(host, strconv.Itoa(port))
	return c.knownHosts.Trust(address)
}

// Connect 建立安全 SSH 連線，並引入 known_hosts 安全比對
func (c *Connector) Connect(config dto.SSHConfig) (*cryptossh.Client, error) {
	if err := ValidateConfig(config); err != nil {
		return nil, err
	}

	authMethods, err := buildAuthMethods(config)
	if err != nil {
		return nil, err
	}

	callback, err := c.knownHosts.GetHostKeyCallback()
	if err != nil {
		return nil, err
	}

	clientConfig := &cryptossh.ClientConfig{
		User:            config.Username,
		Auth:            authMethods,
		HostKeyCallback: callback,
		Timeout:         12 * time.Second,
	}

	address := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	return cryptossh.Dial("tcp", address, clientConfig)
}

// ConnectWithContext 在特定 Context 下建立安全 SSH 連線
func (c *Connector) ConnectWithContext(ctx context.Context, config dto.SSHConfig) (*cryptossh.Client, error) {
	if err := ValidateConfig(config); err != nil {
		return nil, err
	}

	authMethods, err := buildAuthMethods(config)
	if err != nil {
		return nil, err
	}

	callback, err := c.knownHosts.GetHostKeyCallback()
	if err != nil {
		return nil, err
	}

	clientConfig := &cryptossh.ClientConfig{
		User:            config.Username,
		Auth:            authMethods,
		HostKeyCallback: callback,
		Timeout:         12 * time.Second,
	}

	address := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}

	// 在底層 TCP 連線交給 SSH 握手前，開啟 TCP keepalive 與 NoDelay，加快半死連線偵測、
	// 降低互動輸入延遲。錯誤僅記錄、不改變成功路徑（TCPConn 型別斷言失敗時直接略過）。
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		if kaErr := tcpConn.SetKeepAlive(true); kaErr != nil {
			common.DomainLogger("ssh").Warnf("ConnectWithContext: 設定 TCP keepalive 失敗（略過）：%v", kaErr)
		}
		if kaErr := tcpConn.SetKeepAlivePeriod(15 * time.Second); kaErr != nil {
			common.DomainLogger("ssh").Warnf("ConnectWithContext: 設定 TCP keepalive period 失敗（略過）：%v", kaErr)
		}
		if ndErr := tcpConn.SetNoDelay(true); ndErr != nil {
			common.DomainLogger("ssh").Warnf("ConnectWithContext: 設定 TCP NoDelay 失敗（略過）：%v", ndErr)
		}
	}

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()

	sshConn, chans, reqs, err := cryptossh.NewClientConn(conn, address, clientConfig)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}

	return cryptossh.NewClient(sshConn, chans, reqs), nil
}

func ValidateConfig(config dto.SSHConfig) error {
	if strings.TrimSpace(config.Host) == "" {
		return errors.New("SSH Host 不可空白")
	}
	if config.Port < 1 || config.Port > 65535 {
		return errors.New("SSH Port 必須介於 1 到 65535")
	}
	if strings.TrimSpace(config.Username) == "" {
		return errors.New("SSH Username 不可空白")
	}
	if config.Username == "ops" && config.AuthMode != constants.AuthModeKey {
		return errors.New("ops 使用者只能使用 key 登入")
	}
	if config.AuthMode != constants.AuthModeKey && config.AuthMode != constants.AuthModePassword {
		return errors.New("登入方式必須是 key 或 password")
	}
	if config.AuthMode == constants.AuthModePassword && config.Password == "" {
		return errors.New("密碼登入必須提供 SSH password")
	}
	if config.AuthMode == constants.AuthModeKey {
		if strings.TrimSpace(config.PrivateKeyPath) == "" {
			return errors.New("key 登入必須提供 private key path")
		}
		if _, err := os.Stat(common.ExpandHome(config.PrivateKeyPath)); err != nil {
			return fmt.Errorf("private key path 無法讀取：%w", err)
		}
		if strings.TrimSpace(config.CertPath) != "" {
			if _, err := os.Stat(common.ExpandHome(config.CertPath)); err != nil {
				return fmt.Errorf("cert path 無法讀取：%w", err)
			}
		}
	}
	return nil
}

func buildAuthMethods(config dto.SSHConfig) ([]cryptossh.AuthMethod, error) {
	if config.AuthMode == constants.AuthModePassword {
		return []cryptossh.AuthMethod{
			cryptossh.Password(config.Password),
			keyboardInteractivePassword(config.Password),
		}, nil
	}

	keyBytes, err := os.ReadFile(common.ExpandHome(config.PrivateKeyPath))
	if err != nil {
		return nil, err
	}
	signer, err := cryptossh.ParsePrivateKey(keyBytes)
	if err != nil {
		if strings.TrimSpace(config.Password) == "" {
			return nil, err
		}
		signer, err = cryptossh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(config.Password))
		if err != nil {
			return nil, err
		}
	}
	authMethods := []cryptossh.AuthMethod{}
	if strings.TrimSpace(config.CertPath) == "" {
		authMethods = append(authMethods, cryptossh.PublicKeys(signer))
	} else {
		certBytes, err := os.ReadFile(common.ExpandHome(config.CertPath))
		if err != nil {
			return nil, err
		}
		publicKey, _, _, _, err := cryptossh.ParseAuthorizedKey(certBytes)
		if err != nil {
			return nil, err
		}
		cert, ok := publicKey.(*cryptossh.Certificate)
		if !ok {
			return nil, errors.New("cert path 不是有效的 SSH certificate")
		}
		certSigner, err := cryptossh.NewCertSigner(cert, signer)
		if err != nil {
			return nil, err
		}
		authMethods = append(authMethods, cryptossh.PublicKeys(certSigner, signer))
	}

	// 注意：key 登入模式下 config.Password 帶的是私鑰 passphrase（見
	// hostvault.ResolveRuntimeConfig，AuthModeKey 分支以 KeyPassphraseRef 填入），
	// 該值已於上方 ParsePrivateKeyWithPassphrase 使用。此處刻意不再將 passphrase
	// 當成 SSH 登入密碼送給伺服器，避免把 passphrase 洩漏到 password /
	// keyboard-interactive 認證欄位。
	return authMethods, nil
}

// keyboardInteractivePassword 僅在伺服器的互動式提問明顯屬於密碼提示時才回填密碼，
// 其餘問題一律回空字串，避免惡意/被入侵的伺服器藉互動式提問誘騙客戶端把密碼洩漏到
// 非預期欄位。回傳 slice 長度必定等於 questions 長度。
func keyboardInteractivePassword(password string) cryptossh.AuthMethod {
	return cryptossh.KeyboardInteractive(func(user string, instruction string, questions []string, echos []bool) ([]string, error) {
		answers := make([]string, len(questions))
		for i, question := range questions {
			// echos[i] 為 true 代表伺服器要求回顯輸入，通常屬於非密碼類提示
			// （如帳號、OTP），此時不回填密碼。
			if i < len(echos) && echos[i] {
				continue
			}
			if isPasswordPrompt(question) {
				answers[i] = password
			}
		}
		return answers, nil
	})
}

// isPasswordPrompt 判斷互動式提問文字是否為密碼提示。
func isPasswordPrompt(question string) bool {
	normalized := strings.ToLower(strings.TrimSpace(question))
	if normalized == "" {
		return false
	}
	passwordKeywords := []string{"password", "passwd", "密碼", "密码"}
	for _, keyword := range passwordKeywords {
		if strings.Contains(normalized, keyword) {
			return true
		}
	}
	return false
}

func scriptHeader(config dto.SSHConfig) string {
	needsPassword := "false"
	if NeedsSudoPassword(config) {
		needsPassword = "true"
	}

	return fmt.Sprintf(`set -e
NEEDS_SUDO=%s
SUDO_PASSWORD=%s
run_sudo() {
  if [ "$NEEDS_SUDO" = "true" ]; then
    printf '%%s\n' "$SUDO_PASSWORD" | sudo -S -p '' "$@"
  else
    sudo "$@"
  fi
}
if [ "$NEEDS_SUDO" = "true" ]; then
  echo '[Sudo] 驗證 sudo password'
  if ! printf '%%s\n' "$SUDO_PASSWORD" | sudo -S -p '' -v; then
    echo '[Sudo] sudo password 驗證失敗'
    exit 1
  fi
  echo '[Sudo] sudo password 驗證成功'
fi
`, needsPassword, common.ShellQuote(config.SudoPassword))
}

func NeedsSudoPassword(config dto.SSHConfig) bool {
	return !(config.Username == "ops" && config.AuthMode == constants.AuthModeKey)
}

func RunRemoteCommand(client *cryptossh.Client, command string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	// RequestPty 失敗通常仍可執行多數指令（僅缺 TTY），因此不視為致命錯誤而中斷成功路徑，
	// 但記錄下來以利診斷需要 TTY 的指令為何行為異常。
	if err := session.RequestPty("xterm", 40, 120, cryptossh.TerminalModes{
		cryptossh.ECHO:          0,
		cryptossh.TTY_OP_ISPEED: 14400,
		cryptossh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		common.DomainLogger("ssh").Warnf("RunRemoteCommand: RequestPty 失敗（將以無 PTY 模式繼續執行）：%v", err)
	}

	type result struct {
		output string
		err    error
	}
	done := make(chan result, 1)
	go func() {
		output, err := session.CombinedOutput(command)
		done <- result{output: string(output), err: err}
	}()

	select {
	case <-ctx.Done():
		_ = session.Close()
		select {
		case res := <-done:
			return common.StripANSI(res.output), errors.New("遠端指令逾時")
		case <-time.After(2 * time.Second):
			return "", errors.New("遠端指令逾時")
		}
	case res := <-done:
		return common.StripANSI(res.output), res.err
	}
}

// TestConnection 驗證 SSH 連線配置並測試遠端指令執行
func (c *Connector) TestConnection(config dto.SSHConfig) dto.OperationResult {
	var log strings.Builder
	common.WriteLog(&log, "Connection", "驗證 SSH 設定")
	client, err := c.Connect(config)
	if err != nil {
		return dto.OperationResult{Success: false, Output: log.String(), Error: err.Error()}
	}
	defer client.Close()
	common.WriteLog(&log, "Connection", fmt.Sprintf("已連線至 %s@%s:%d，登入方式：%s", config.Username, config.Host, config.Port, config.AuthMode))

	output, err := RunRemoteCommand(client, "whoami && hostname", 45*time.Second)
	if err != nil {
		return dto.OperationResult{Success: false, Output: log.String() + output, Error: err.Error()}
	}
	common.WriteLog(&log, "Remote", "whoami 與 hostname 執行完成")
	return dto.OperationResult{Success: true, Output: log.String() + output}
}
