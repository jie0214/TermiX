package sftp

import (
	"context"
	"errors"
	pkgsftp "github.com/pkg/sftp"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestCompletedTransferRetainsAverageSpeed(t *testing.T) {
	m, r, c := testManager(t)
	session := connectTrusted(t, m, r, c)
	local, remote := t.TempDir(), t.TempDir()
	source := filepath.Join(local, "small.txt")
	writeTestFile(t, source, []byte("small upload"))
	if err := m.Queue(session.ID, "upload", []string{source}, remote); err != nil {
		t.Fatal(err)
	}
	result := waitTransfers(t, m)[0]
	if result.Status != "completed" {
		t.Fatalf("預期成功：%+v", result)
	}
	if result.Speed <= 0 {
		t.Fatalf("完成後平均速度不得歸零：speed=%v bytes=%d", result.Speed, result.Bytes)
	}
}

func TestSourceTruncatedAfterScanIsNotSuccessful(t *testing.T) {
	m, r, c := testManager(t)
	session := connectTrusted(t, m, r, c)
	local, remote := t.TempDir(), t.TempDir()
	source := filepath.Join(local, "changing.txt")
	writeTestFile(t, source, []byte("original content"))
	conn, err := m.get(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	var written, expected int64
	err = transfer(context.Background(), conn.client, job{source: source, destination: remote, upload: true}, func(n int64) { written += n }, func(n int64) {
		expected = n
		// 在掃描完成後、讀取前模擬另一個程式改寫來源。
		if e := os.Truncate(source, 0); e != nil {
			t.Fatal(e)
		}
	})
	if err == nil {
		t.Fatalf("不完整上傳被視為成功：bytes=%d total=%d", written, expected)
	}
}

type faultWriter struct {
	base pkgsftp.FileWriter
	mode string
}

func (f faultWriter) Filewrite(r *pkgsftp.Request) (io.WriterAt, error) {
	if f.mode == "permission" {
		return nil, os.ErrPermission
	}
	writer, err := f.base.Filewrite(r)
	if err != nil {
		return nil, err
	}
	return &faultHandle{WriterAt: writer, mode: f.mode}, nil
}

type faultHandle struct {
	io.WriterAt
	mode string
}

func (f *faultHandle) WriteAt(p []byte, offset int64) (int, error) {
	if f.mode == "write" {
		return 0, errors.New("測試寫入失敗")
	}
	if f.mode == "missing-data" {
		return len(p), nil
	}
	return f.WriterAt.WriteAt(p, offset)
}
func (f *faultHandle) Close() error {
	if f.mode == "close" {
		return errors.New("測試關閉失敗")
	}
	if closer, ok := f.WriterAt.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}
func TestRemoteUploadFailureNeverCompletes(t *testing.T) {
	for _, mode := range []string{"permission", "write", "close", "missing-data"} {
		t.Run(mode, func(t *testing.T) {
			handlers := pkgsftp.InMemHandler()
			handlers.FilePut = faultWriter{base: handlers.FilePut, mode: mode}
			m, r, c := testManager(t, handlers)
			session := connectTrusted(t, m, r, c)
			source := filepath.Join(t.TempDir(), "upload.txt")
			writeTestFile(t, source, []byte("remote error reproduction"))
			if err := m.Queue(session.ID, "upload", []string{source}, "/"); err != nil {
				t.Fatal(err)
			}
			result := waitTransfers(t, m)[0]
			if result.Bytes > 0 && result.Speed <= 0 {
				t.Fatal("失敗紀錄也應保留已傳輸部分的平均速度")
			}
			if result.Status != "failed" || result.Error == "" {
				t.Fatalf("遠端 %s 失敗被誤標完成：status=%s bytes=%d total=%d error=%q", mode, result.Status, result.Bytes, result.Total, result.Error)
			}
		})
	}
}
