package integration

import (
	"fmt"
	"os"
	"path/filepath"
	termixapp "github.com/jie0214/TermiX/backend/app"
	"github.com/jie0214/TermiX/backend/controlpanel"
	"github.com/jie0214/TermiX/backend/hostvault"
	"github.com/jie0214/TermiX/backend/keychain"
	"github.com/jie0214/TermiX/backend/knownhosts"
	"github.com/jie0214/TermiX/backend/kubernetes"
	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/snippets"
	"github.com/jie0214/TermiX/backend/ssh"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/backend/terminal"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestIntegrationSSHInteract(t *testing.T) {
	if envValue("TERMIX_INTEGRATION", "SLOT_ADMIN_INTEGRATION") != "1" {
		t.Skip("設定 TERMIX_INTEGRATION=1 才執行遠端通用 SSH 整合測試")
	}

	host := envValue("TERMIX_HOST", "SLOT_ADMIN_HOST")
	if host == "" {
		t.Fatal("未設定 TERMIX_HOST 環境變數")
	}

	portStr := envValue("TERMIX_PORT", "SLOT_ADMIN_PORT")
	port := 22
	if portStr != "" {
		p, err := strconv.Atoi(portStr)
		if err != nil {
			t.Fatalf("TERMIX_PORT 格式錯誤：%v", err)
		}
		port = p
	}

	username := envValue("TERMIX_USER", "SLOT_ADMIN_USER")
	if username == "" {
		t.Fatal("未設定 TERMIX_USER 環境變數")
	}

	password := envValue("TERMIX_PASSWORD", "SLOT_ADMIN_PASSWORD")
	sudoPassword := envValue("TERMIX_SUDO_PASSWORD", "SLOT_ADMIN_SUDO_PASSWORD")

	sshConfig := termixapp.SSHConfig{
		Host:         host,
		Port:         port,
		Username:     username,
		AuthMode:     "password",
		Password:     password,
		SudoPassword: sudoPassword,
		SessionID:    "integration-test-session",
	}

	// 1. 驗證連線測試 API
	t.Log("測試 TestConnection...")
	validator := knownhosts.NewValidator()
	connector := ssh.NewConnector(validator)
	termMgr := terminal.NewManager(connector)
	ctrlPanel := controlpanel.NewExecutor()
	db, err := storage.OpenDatabase(filepath.Join(t.TempDir(), "termix.db"))
	if err != nil {
		t.Fatalf("OpenDatabase 失敗：%v", err)
	}
	repo := storage.NewRepository(db)
	secretStore := secrets.NewMemoryStore()
	keychainSvc := keychain.NewService(repo, secretStore)
	hostVaultSvc := hostvault.NewService(repo, secretStore, keychainSvc)
	app := termixapp.NewApp(termMgr, ctrlPanel, connector, snippets.NewService(termMgr), hostVaultSvc, kubernetes.NewService(repo), keychainSvc)
	testRes := app.TestConnection(sshConfig)
	if !testRes.Success {
		t.Fatalf("TestConnection 失敗：%s, Output: %s", testRes.Error, testRes.Output)
	}
	t.Logf("TestConnection 成功，遠端主機資訊：%s", strings.TrimSpace(testRes.Output))

	// 2. 測試 ConnectTerminal 建立持久 Session
	t.Log("測試 ConnectTerminal 建立 Session...")
	connRes := app.ConnectTerminal(sshConfig)
	if !connRes.Success {
		t.Fatalf("ConnectTerminal 失敗：%s, Output: %s", connRes.Error, connRes.Output)
	}
	sessionKey := connRes.SessionKey
	t.Logf("ConnectTerminal 成功，SessionKey: %s", sessionKey)

	// 確保結束時清理連線
	defer func() {
		t.Log("測試 CloseTerminalSession...")
		app.CloseTerminalSession(sessionKey)
		t.Log("連線銷毀完成")
	}()

	// 3. 測試指令執行 API ExecuteSessionCommand
	t.Log("測試 ExecuteSessionCommand 執行通用指令...")
	execRes := app.ExecuteSessionCommand(sessionKey, "uname -a")
	if !execRes.Success {
		t.Fatalf("ExecuteSessionCommand 失敗：%s", execRes.Error)
	}
	t.Logf("ExecuteSessionCommand 成功，核心版本：%s", strings.TrimSpace(execRes.Output))

	// 4. 測試 Pty 視窗大小 ResizeTerminal 變更
	t.Log("測試 ResizeTerminal...")
	resizeRes := app.ResizeTerminal(sessionKey, 80, 24)
	if !resizeRes.Success {
		t.Fatalf("ResizeTerminal 失敗：%s", resizeRes.Error)
	}
	t.Log("ResizeTerminal 成功，視窗已重設為 80x24")

	// 5. TUI smoke 驗收：確認 PTY、ANSI 與控制序列基礎能力。
	t.Log("測試 TUI smoke 驗收...")
	tuiRes := app.ExecuteSessionCommand(sessionKey, "printf '\\033[31mTERMIX_ANSI_OK\\033[0m\\n' && stty size")
	if !tuiRes.Success {
		t.Fatalf("TUI smoke 驗收失敗：%s", tuiRes.Error)
	}
	if !strings.Contains(tuiRes.Output, "TERMIX_ANSI_OK") {
		t.Fatalf("TUI smoke 輸出缺少 TERMIX_ANSI_OK：%s", tuiRes.Output)
	}
	t.Logf("TUI smoke 驗收成功：%s", strings.TrimSpace(tuiRes.Output))

	// 6. 擴充測試：stty size 尺寸重設與 Rows/Cols 100% 同步比對
	t.Log("測試 ResizeTerminal 尺寸同步...")
	resizeRes2 := app.ResizeTerminal(sessionKey, 120, 40)
	if !resizeRes2.Success {
		t.Fatalf("ResizeTerminal 失敗：%s", resizeRes2.Error)
	}
	tuiSizeRes := app.ExecuteSessionCommand(sessionKey, "stty size")
	if !tuiSizeRes.Success {
		t.Fatalf("stty size 獲取失敗：%s", tuiSizeRes.Error)
	}
	sizeOutput := strings.TrimSpace(tuiSizeRes.Output)
	if sizeOutput != "40 120" {
		t.Fatalf("stty size 校正失敗：預期 '40 120'，實際 '%s'", sizeOutput)
	}
	t.Logf("stty size 同步尺寸驗證成功：%s", sizeOutput)

	// 7. 擴充測試：ANSI 深度色彩與粗體/背景樣式檢驗
	t.Log("測試 ANSI 深度色彩彩現...")
	ansiRes := app.ExecuteSessionCommand(sessionKey, `printf "\033[1;33;44mTERMIX_ANSI_BOLD_YELLOW_ON_BLUE\033[0m\n"`)
	if !ansiRes.Success {
		t.Fatalf("ANSI 深度測試失敗：%s", ansiRes.Error)
	}
	if !strings.Contains(ansiRes.Output, "TERMIX_ANSI_BOLD_YELLOW_ON_BLUE") {
		t.Fatalf("ANSI 輸出遺失 TERMIX_ANSI_BOLD_YELLOW_ON_BLUE：%s", ansiRes.Output)
	}
	t.Logf("ANSI 深度彩現檢驗成功：%s", strings.TrimSpace(ansiRes.Output))

	// 8. 擴充測試：互動式 TUI 直通讀寫與 stty -echo 敏感資料輸入
	t.Log("測試互動式 TUI 直通與 stty -echo 敏感資料輸入...")

	// 啟動非同步協程，延遲發送直通密碼與換行符
	go func() {
		time.Sleep(500 * time.Millisecond)
		t.Log("非同步直通寫入密碼...")
		app.WriteTerminalInput(sessionKey, "TermiX_Super_Secret\n")
	}()

	// 執行互動式 Shell read 指令
	// stty -echo 用於關閉回顯，保證密碼不回顯；隨後讀取 SECRET，最後 echo 出 VAL
	interactRes := app.ExecuteSessionCommand(sessionKey, "stty -echo && read -p 'SECRET:' val && echo 'VAL:'$val && stty echo")
	if !interactRes.Success {
		t.Fatalf("互動式 TUI 直通執行失敗：%s", interactRes.Error)
	}

	output := interactRes.Output
	t.Logf("互動式 TUI 輸出結果：\n%s", output)

	// 驗收 1：輸出中必須包含直通結果 "VAL:TermiX_Super_Secret"
	if !strings.Contains(output, "VAL:TermiX_Super_Secret") {
		t.Fatalf("互動式 TUI 直通驗收失敗：輸出中未包含 'VAL:TermiX_Super_Secret'")
	}

	// 驗收 2：敏感密碼 "TermiX_Super_Secret" 不得在螢幕上被 echo 回顯（除 VAL 外不得出現在其他行）
	cleanedOutput := strings.Replace(output, "VAL:TermiX_Super_Secret", "", -1)
	if strings.Contains(cleanedOutput, "TermiX_Super_Secret") {
		t.Fatalf("安全性漏洞：敏感密碼被回顯在終端螢幕上！")
	}

	t.Log("互動式 TUI 直通與 stty -echo 安全驗收成功！")
}

func TestIntegrationSSHSudoConnect(t *testing.T) {
	if envValue("TERMIX_INTEGRATION", "SLOT_ADMIN_INTEGRATION") != "1" {
		t.Skip("設定 TERMIX_INTEGRATION=1 才執行遠端 sudo 整合測試")
	}

	host := envValue("TERMIX_HOST", "SLOT_ADMIN_HOST")
	if host == "" {
		t.Fatal("未設定 TERMIX_HOST 環境變數")
	}

	portStr := envValue("TERMIX_PORT", "SLOT_ADMIN_PORT")
	port := 22
	if portStr != "" {
		p, err := strconv.Atoi(portStr)
		if err != nil {
			t.Fatalf("TERMIX_PORT 格式錯誤：%v", err)
		}
		port = p
	}

	username := envValue("TERMIX_USER", "SLOT_ADMIN_USER")
	if username == "" {
		t.Fatal("未設定 TERMIX_USER 環境變數")
	}

	password := envValue("TERMIX_PASSWORD", "SLOT_ADMIN_PASSWORD")
	sudoPassword := envValue("TERMIX_SUDO_PASSWORD", "SLOT_ADMIN_SUDO_PASSWORD")
	if sudoPassword == "" {
		t.Skip("未設定 TERMIX_SUDO_PASSWORD，略過 sudo 提權整合測試")
	}

	sshConfig := termixapp.SSHConfig{
		Host:         host,
		Port:         port,
		Username:     username,
		AuthMode:     "password",
		Password:     password,
		SudoPassword: sudoPassword,
		SessionID:    "integration-test-sudo-session",
	}

	validator := knownhosts.NewValidator()
	connector := ssh.NewConnector(validator)
	termMgr := terminal.NewManager(connector)
	ctrlPanel := controlpanel.NewExecutor()
	db, err := storage.OpenDatabase(filepath.Join(t.TempDir(), "termix-sudo.db"))
	if err != nil {
		t.Fatalf("OpenDatabase 失敗：%v", err)
	}
	repo := storage.NewRepository(db)
	secretStore := secrets.NewMemoryStore()
	keychainSvc := keychain.NewService(repo, secretStore)
	hostVaultSvc := hostvault.NewService(repo, secretStore, keychainSvc)
	app := termixapp.NewApp(termMgr, ctrlPanel, connector, snippets.NewService(termMgr), hostVaultSvc, kubernetes.NewService(repo), keychainSvc)

	connRes := app.ConnectTerminal(sshConfig)
	if !connRes.Success {
		t.Fatalf("ConnectTerminal sudo 連線失敗：%s, Output: %s", connRes.Error, connRes.Output)
	}
	if !connRes.IsSudo {
		t.Fatalf("ConnectTerminal 未標記 sudo session：%+v", connRes)
	}

	sessionKey := connRes.SessionKey
	defer app.CloseTerminalSession(sessionKey)

	whoamiRes := app.ExecuteSessionCommand(sessionKey, "whoami")
	if !whoamiRes.Success {
		t.Fatalf("whoami 執行失敗：%s, Output: %s", whoamiRes.Error, whoamiRes.Output)
	}
	if strings.TrimSpace(whoamiRes.Output) != "root" {
		t.Fatalf("sudo shell 未提權成功：whoami = %q", strings.TrimSpace(whoamiRes.Output))
	}

	isolatedRes := app.ExecuteSessionCommandIsolated(sessionKey, "sudo -n true && echo TERMIX_SUDO_OK")
	if !isolatedRes.Success {
		t.Fatalf("隔離式 sudo 驗證失敗：%s, Output: %s", isolatedRes.Error, isolatedRes.Output)
	}
	if !strings.Contains(isolatedRes.Output, "TERMIX_SUDO_OK") {
		t.Fatalf("隔離式 sudo 驗證輸出缺少成功旗標：%q", isolatedRes.Output)
	}

	t.Log(fmt.Sprintf("sudo 連線驗證成功：session=%s", sessionKey))
}

func envValue(primary string, legacy string) string {
	if value := os.Getenv(primary); value != "" {
		return value
	}
	return os.Getenv(legacy)
}
