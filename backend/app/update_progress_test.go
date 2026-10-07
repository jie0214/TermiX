package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDownloadProgressUsesActualBytes(t *testing.T) {
	for _, total := range []int64{7, -1, 32} {
		destination := filepath.Join(t.TempDir(), "update.zip")
		var samples [][2]int64
		err := downloadFileWithProgress(context.Background(), updateTestClient("package", total), "https://example.test/update", destination, func(received, total int64) { samples = append(samples, [2]int64{received, total}) })
		if (err != nil) != (total == 32) {
			t.Fatalf("非預期下載結果：%v", err)
		}
		if len(samples) < 2 || samples[0][0] != 0 || samples[len(samples)-1][0] != 7 {
			t.Fatalf("進度未反映實際傳輸：%v", samples)
		}
		expected := total
		if expected < 0 {
			expected = 0
		}
		if samples[len(samples)-1][1] != expected {
			t.Fatalf("總容量錯誤：%v", samples)
		}
		if total == 32 {
			if _, err := os.Stat(destination); !os.IsNotExist(err) {
				t.Fatal("不完整檔案不應發布")
			}
		}
	}
}
func TestUpdateProgressRetainedForFrontendInitialization(t *testing.T) {
	a := &App{}
	progress := UpdateProgress{Version: "1.10.0", Status: "downloading", ReceivedBytes: 68, TotalBytes: 100}
	NotifyUpdateProgress(a, progress)
	if a.updateProgress != progress {
		t.Fatal("前端就緒前的進度遺失")
	}
	if a.HandleNativeUpdateCheck(false) {
		t.Fatal("進度補送不可使不存在的原生更新器攔截檢查")
	}
}
