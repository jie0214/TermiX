package app

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func updateTestClient(content string, contentLength int64) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			Body:          io.NopCloser(strings.NewReader(content)),
			ContentLength: contentLength,
			Header:        make(http.Header),
			Request:       request,
		}, nil
	})}
}

func TestSafeUpdateAssetName(t *testing.T) {
	t.Parallel()

	valid := "TermiX-1.8.0-macos.zip"
	if got, err := safeUpdateAssetName(valid); err != nil || got != valid {
		t.Fatalf("合法附件名稱遭拒：got=%q err=%v", got, err)
	}
	for _, name := range []string{"", ".", "..", "../evil.zip", `..\\evil.zip`, "folder/evil.zip", "evil package.zip", "evil:package.zip"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := safeUpdateAssetName(name); err == nil {
				t.Fatalf("危險附件名稱未遭拒：%q", name)
			}
		})
	}
}

func TestValidGitHubReleaseURLs(t *testing.T) {
	t.Parallel()

	if !validGitHubReleasePageURL("https://github.com/jie0214/TermiX/releases/tag/v1.8.0") {
		t.Fatal("合法 Release 頁面 URL 遭拒")
	}
	if !validGitHubReleaseAssetURL("https://github.com/jie0214/TermiX/releases/download/v1.8.0/TermiX.zip") {
		t.Fatal("合法 Release 附件 URL 遭拒")
	}
	for _, rawURL := range []string{
		"http://github.com/jie0214/TermiX/releases/download/v1.8.0/TermiX.zip",
		"https://user@github.com/jie0214/TermiX/releases/download/v1.8.0/TermiX.zip",
		"https://github.com:443/jie0214/TermiX/releases/download/v1.8.0/TermiX.zip",
		"https://example.com/jie0214/TermiX/releases/download/v1.8.0/TermiX.zip",
		"javascript:alert(1)",
	} {
		if validGitHubReleasePageURL(rawURL) || validGitHubReleaseAssetURL(rawURL) {
			t.Fatalf("非官方 URL 未遭拒：%q", rawURL)
		}
	}
}

func TestDownloadFileAtomicallyReplacesDestination(t *testing.T) {
	t.Parallel()

	destination := filepath.Join(t.TempDir(), "TermiX.zip")
	if err := os.WriteFile(destination, []byte("old package"), 0600); err != nil {
		t.Fatal(err)
	}
	client := updateTestClient("complete package", int64(len("complete package")))
	if err := downloadFileWithClient(context.Background(), client, "https://example.test/package", destination); err != nil {
		t.Fatalf("下載更新失敗：%v", err)
	}
	content, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "complete package" {
		t.Fatalf("目標檔案內容錯誤：%q", content)
	}
}

func TestDownloadFilePreservesDestinationOnFailure(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	destination := filepath.Join(dir, "TermiX.zip")
	if err := os.WriteFile(destination, []byte("old package"), 0600); err != nil {
		t.Fatal(err)
	}
	client := updateTestClient("partial", 32)
	if err := downloadFileWithClient(context.Background(), client, "https://example.test/package", destination); err == nil {
		t.Fatal("不完整下載應回傳錯誤")
	}
	content, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "old package" {
		t.Fatalf("失敗下載覆寫既有檔案：%q", content)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".termix-update-") {
			t.Fatalf("失敗下載殘留暫存檔：%s", entry.Name())
		}
	}
}
