package app

import (
	"io"
	"time"

	"github.com/jie0214/TermiX/shared/events"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// UpdateProgress 的 totalBytes 為 0 時代表來源未提供可量測的總量。
type UpdateProgress struct {
	Version       string `json:"version"`
	Status        string `json:"status"`
	ReceivedBytes int64  `json:"receivedBytes"`
	TotalBytes    int64  `json:"totalBytes"`
}

// NotifyUpdateProgress 也保存最近狀態，避免前端尚未初始化時漏接事件。
func NotifyUpdateProgress(a *App, progress UpdateProgress) {
	a.updateMu.Lock()
	a.updateProgress = progress
	a.updateMu.Unlock()
	a.emitUpdateProgress(progress)
}
func (a *App) emitUpdateProgress(progress UpdateProgress) {
	if a.ctx != nil && progress.Status != "" {
		runtime.EventsEmit(a.ctx, events.EventUpdateProgress, progress)
	}
}

type updateProgressWriter struct {
	received, total int64
	last            time.Time
	report          func(int64, int64)
}

func (w *updateProgressWriter) Write(p []byte) (int, error) {
	w.received += int64(len(p))
	if time.Since(w.last) >= 100*time.Millisecond {
		w.report(w.received, w.total)
		w.last = time.Now()
	}
	return len(p), nil
}
func copyUpdateWithProgress(dst io.Writer, src io.Reader, total int64, report func(int64, int64)) (int64, error) {
	if report == nil {
		return io.Copy(dst, src)
	}
	if total < 0 {
		total = 0
	}
	progress := &updateProgressWriter{total: total, report: report}
	report(0, total)
	written, err := io.Copy(io.MultiWriter(dst, progress), src)
	report(written, total)
	return written, err
}
