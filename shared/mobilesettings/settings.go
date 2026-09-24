// Package mobilesettings 定義桌面與手機共用的一般設定白名單。
package mobilesettings

import (
	"encoding/json"
	"errors"
	"net"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf16"
)

const Version = "termix.mobile-settings.v2"
const MaxBytes = 256 * 1024
const MaxHosts = 500

type Host struct {
	FolderPath []string `json:"folderPath"`
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Address    string   `json:"address"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
}
type Document struct {
	Version  string `json:"version"`
	SourceID string `json:"sourceId"`
	Hosts    []Host `json:"hosts"`
}

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)
var dnsLabel = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

func validText(s string, max int, noSpace bool) bool {
	if s == "" || s != strings.TrimSpace(s) || len(utf16.Encode([]rune(s))) > max {
		return false
	}
	for _, r := range s {
		if r < 32 || r == 127 || (noSpace && unicode.IsSpace(r)) {
			return false
		}
	}
	return true
}
func validAddress(s string) bool {
	if net.ParseIP(s) != nil {
		return true
	}
	if len(s) > 253 || strings.Contains(s, ":") || strings.Trim(s, "0123456789.") == "" {
		return false
	}
	for _, label := range strings.Split(strings.TrimSuffix(s, "."), ".") {
		if !dnsLabel.MatchString(label) {
			return false
		}
	}
	return true
}
func Encode(source string, hosts []Host) (string, error) {
	invalid := errors.New("主機資料不符合手機同步格式；請檢查名稱、位址、使用者及連接埠（最多 500 筆、256 KB）。")
	if !identifier.MatchString(source) || len(hosts) > MaxHosts {
		return "", invalid
	}
	seen := map[string]bool{}
	for i, h := range hosts {
		if len(h.FolderPath) > 16 {
			return "", invalid
		}
		for _, part := range h.FolderPath {
			if !validText(part, 80, false) || strings.Contains(part, "/") || part == "." || part == ".." {
				return "", invalid
			}
		}
		if h.FolderPath == nil {
			hosts[i].FolderPath = []string{}
		}
		if !identifier.MatchString(h.ID) || seen[h.ID] || !validText(h.Name, 80, false) || !validText(h.Username, 128, true) || !validAddress(h.Address) || h.Port < 1 || h.Port > 65535 {
			return "", invalid
		}
		seen[h.ID] = true
	}
	if hosts == nil {
		hosts = []Host{}
	}
	raw, err := json.Marshal(Document{Version, source, hosts})
	if err != nil {
		return "", err
	}
	if len(raw) > MaxBytes {
		return "", invalid
	}
	return string(raw), nil
}
