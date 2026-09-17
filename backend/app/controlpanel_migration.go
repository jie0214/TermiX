package app

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"unicode/utf16"
)

// GetLegacyControlPanelComponents 只讀取舊正式 App 的組件，不搬移開發伺服器或其他網站資料。
func (a *App) GetLegacyControlPanelComponents() (string, error) {
	if runtime.GOOS != "darwin" {
		return "", nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return readLegacyControlPanel(filepath.Join(home, "Library", "WebKit", "com.wails.TermiX", "WebsiteData"))
}

func (a *App) GetLegacyWebSettings() (map[string]string, error) {
	if runtime.GOOS != "darwin" {
		return map[string]string{}, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	root := filepath.Join(home, "Library", "WebKit", "com.wails.TermiX", "WebsiteData")
	result := map[string]string{}
	for _, key := range []string{"termix-custom-components", "termix-global-settings", "termix-snippets", "termix-snippet-packages", "termix-session-logs", "termix-hostvault-view-prefs", "termix-kubernetes-view-prefs", "control-sidebar-width"} {
		value, err := readLegacyWebValue(root, key)
		if err != nil {
			return nil, err
		}
		if value != "" {
			result[key] = value
		}
	}
	return result, nil
}

func readLegacyControlPanel(root string) (string, error) {
	return readLegacyWebValue(root, "termix-custom-components")
}

func readLegacyWebValue(root, key string) (string, error) {
	// WebKit 的 origin 記錄含 top origin 與 client origin；只接受 wails://wails。
	origin := []byte{5, 0, 0, 0, 1, 'w', 'a', 'i', 'l', 's', 5, 0, 0, 0, 1, 'w', 'a', 'i', 'l', 's', 0}
	expectedOrigin := append(append([]byte{}, origin...), origin...)
	var result string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) && path == root {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if (entry.Name() != "localstorage.sqlite3" && entry.Name() != "wails_wails_0.localstorage") || !entry.Type().IsRegular() {
			return nil
		}
		data, err := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(path)), "origin"))
		if entry.Name() != "wails_wails_0.localstorage" && (err != nil || !bytes.Equal(data, expectedOrigin)) {
			return nil
		}
		dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&_pragma=busy_timeout(1000)"}).String()
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			return fmt.Errorf("無法讀取舊版 Control Panel：%w", err)
		}
		defer db.Close()
		var raw []byte
		var valueType string
		err = db.QueryRow("SELECT substr(value, 1, 16777217), typeof(value) FROM ItemTable WHERE key = ?", key).Scan(&raw, &valueType)
		if err == sql.ErrNoRows {
			return nil
		}
		if err != nil {
			return fmt.Errorf("讀取舊版 Control Panel 失敗：%w", err)
		}
		if len(raw) > 16*1024*1024 || (valueType != "text" && len(raw)%2 != 0) {
			return fmt.Errorf("舊版 Control Panel 資料編碼或大小異常")
		}
		decoded := string(raw)
		if valueType != "text" {
			units := make([]uint16, len(raw)/2)
			for i := range units {
				units[i] = binary.LittleEndian.Uint16(raw[i*2:])
			}
			decoded = string(utf16.Decode(units))
		}
		if key == "termix-custom-components" {
			var components []json.RawMessage
			if err := json.Unmarshal([]byte(decoded), &components); err != nil {
				return fmt.Errorf("舊版 Control Panel 不是有效清單")
			}
			if len(components) == 0 {
				return nil
			}
		}
		if result != "" && result != decoded {
			return fmt.Errorf("找到多份不同的舊版 Control Panel，停止自動遷移")
		}
		result = decoded
		return nil
	})
	return result, err
}
