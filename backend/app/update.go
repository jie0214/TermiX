package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Version 為建置時注入的版本號（見 main.go，透過 -ldflags "-X main.version=X.Y.Z"）。
// 預設 "dev" 代表本機開發建置；開發建置不進行更新檢查。
var Version = "dev"

// releaseAPIURL 為 GitHub 最新 Release 查詢端點。
const releaseAPIURL = "https://api.github.com/repos/jie0214/TermiX/releases/latest"

// UpdateInfo 為回報給前端的更新檢查結果。
type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	HasUpdate      bool   `json:"hasUpdate"`
}

// CheckForUpdate 查詢 GitHub 最新 Release 並與目前版本比較。
// 設計為「永不失敗」：任何錯誤都回傳 HasUpdate=false，避免影響 App 啟動與使用。
func (a *App) CheckForUpdate() UpdateInfo {
	info := UpdateInfo{CurrentVersion: Version}
	if Version == "dev" || Version == "" {
		return info
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPIURL, nil)
	if err != nil {
		return info
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "TermiX-update-check")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return info
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return info
	}

	var payload struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return info
	}

	info.LatestVersion = strings.TrimPrefix(strings.TrimSpace(payload.TagName), "v")
	info.ReleaseURL = payload.HTMLURL
	info.HasUpdate = compareVersions(info.LatestVersion, strings.TrimPrefix(Version, "v")) > 0
	return info
}

// compareVersions 比較兩個點分數字版本（如 "1.2.0"）。a>b 回 1、a<b 回 -1、相等回 0。
// 缺少的段以 0 視之，pre-release/build 後綴（如 "-beta"）會被忽略。
func compareVersions(a, b string) int {
	as, bs := splitVersion(a), splitVersion(b)
	n := len(as)
	if len(bs) > n {
		n = len(bs)
	}
	for i := 0; i < n; i++ {
		var av, bv int
		if i < len(as) {
			av = as[i]
		}
		if i < len(bs) {
			bv = bs[i]
		}
		if av != bv {
			if av > bv {
				return 1
			}
			return -1
		}
	}
	return 0
}

func splitVersion(v string) []int {
	fields := strings.Split(v, ".")
	out := make([]int, 0, len(fields))
	for _, f := range fields {
		num := f
		if idx := strings.IndexFunc(f, func(r rune) bool { return r < '0' || r > '9' }); idx >= 0 {
			num = f[:idx]
		}
		n, _ := strconv.Atoi(num)
		out = append(out, n)
	}
	return out
}
