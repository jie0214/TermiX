package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

// releaseAsset 為單一 Release 附件（各平台的建置壓縮檔）。
type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

// releasePayload 為 GitHub Release API 回應中我們需要的欄位。
type releasePayload struct {
	TagName string         `json:"tag_name"`
	HTMLURL string         `json:"html_url"`
	Assets  []releaseAsset `json:"assets"`
}

// fetchLatestRelease 查詢 GitHub 最新 Release 原始資料，供檢查與下載共用。
func fetchLatestRelease(ctx context.Context) (*releasePayload, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPIURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "TermiX-update-check")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	var payload releasePayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return &payload, nil
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

	release, err := fetchLatestRelease(ctx)
	if err != nil {
		return info
	}

	info.LatestVersion = strings.TrimPrefix(strings.TrimSpace(release.TagName), "v")
	info.ReleaseURL = release.HTMLURL
	info.HasUpdate = compareVersions(info.LatestVersion, strings.TrimPrefix(Version, "v")) > 0
	return info
}

// DownloadResult 為半自動更新下載的結果，回報下載到的檔案路徑或錯誤。
type DownloadResult struct {
	Success  bool   `json:"success"`
	FilePath string `json:"filePath"`
	Error    string `json:"error"`
}

// DownloadUpdate 下載對應目前平台的更新壓縮檔到「下載」資料夾，並在檔案管理員中顯示。
// 半自動更新：下載完成後由使用者自行解壓縮並覆蓋安裝（未來若導入簽章可在此升級為全自動）。
func (a *App) DownloadUpdate() DownloadResult {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	release, err := fetchLatestRelease(ctx)
	if err != nil {
		return DownloadResult{Error: err.Error()}
	}

	asset := selectAssetForPlatform(release.Assets)
	if asset == nil {
		return DownloadResult{Error: "no update package for current platform"}
	}

	destPath := filepath.Join(downloadsDir(), asset.Name)
	if err := downloadFile(ctx, asset.URL, destPath); err != nil {
		return DownloadResult{Error: err.Error()}
	}

	revealInFileManager(destPath)
	return DownloadResult{Success: true, FilePath: destPath}
}

// selectAssetForPlatform 依目前作業系統挑選對應的 Release 附件。
// 對應發版命名：macOS→"macos"、Windows→"windows"、Linux→"linux"。
func selectAssetForPlatform(assets []releaseAsset) *releaseAsset {
	var keyword string
	switch runtime.GOOS {
	case "darwin":
		keyword = "macos"
	case "windows":
		keyword = "windows"
	case "linux":
		keyword = "linux"
	default:
		return nil
	}
	for i := range assets {
		if strings.Contains(strings.ToLower(assets[i].Name), keyword) {
			return &assets[i]
		}
	}
	return nil
}

// downloadsDir 回傳使用者「下載」資料夾；取不到時退回系統暫存目錄。
func downloadsDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, "Downloads")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return os.TempDir()
}

// downloadFile 以串流方式將 url 下載至 destPath。
func downloadFile(ctx context.Context, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "TermiX-update-check")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// revealInFileManager 在系統檔案管理員中選取剛下載的檔案（best-effort，失敗不影響流程）。
func revealInFileManager(path string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		cmd = exec.Command("explorer", "/select,", path)
	case "linux":
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	default:
		return
	}
	_ = cmd.Start()
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
