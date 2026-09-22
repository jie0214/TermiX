package sftp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"

	pkgsftp "github.com/pkg/sftp"
)

type plannedEntry struct {
	relative  string
	directory bool
	size      int64
}

func transfer(ctx context.Context, remote *pkgsftp.Client, j job, progress, total func(int64)) error {
	localDir := j.destination
	if j.upload {
		localDir = filepath.Dir(j.source)
	}
	root, err := os.OpenRoot(localDir)
	if err != nil {
		return err
	}
	defer root.Close()
	var plan []plannedEntry
	var bytes int64
	var scan func(string, string) error
	scan = func(source, relative string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(plan) >= 100000 {
			return errors.New("資料夾項目超過 100000 個，請拆分傳輸")
		}
		var info os.FileInfo
		var err error
		if j.upload {
			info, err = root.Lstat(source)
		} else {
			info, err = remote.Lstat(source)
		}
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("不傳輸符號連結或特殊檔案：%s", relative)
		}
		plan = append(plan, plannedEntry{relative, info.IsDir(), info.Size()})
		if !info.IsDir() {
			bytes += info.Size()
			return nil
		}
		var children []os.FileInfo
		if j.upload {
			dir, e := root.Open(source)
			if e != nil {
				return e
			}
			children, err = dir.Readdir(-1)
			closeErr := dir.Close()
			if err == nil {
				err = closeErr
			}
		} else {
			children, err = remote.ReadDir(source)
		}
		if err != nil {
			return err
		}
		for _, child := range children {
			if !safeName(child.Name()) {
				return errors.New("遠端或本機目錄包含不安全的檔名")
			}
			if err = scan(path.Join(source, child.Name()), path.Join(relative, child.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	source := j.source
	name := path.Base(source)
	if j.upload {
		source = filepath.Base(source)
		name = source
	}
	if err = scan(source, name); err != nil {
		return err
	}
	total(bytes)
	for _, entry := range plan {
		if err = ctx.Err(); err != nil {
			return err
		}
		local := entry.relative
		remotePath := path.Join(j.destination, entry.relative)
		if !j.upload {
			remotePath = path.Join(path.Dir(j.source), entry.relative)
		}
		if entry.directory {
			if j.upload {
				err = remote.Mkdir(remotePath)
			} else {
				err = root.Mkdir(local, 0700)
			}
			if err != nil {
				return fmt.Errorf("建立目的資料夾失敗（不合併既有資料夾）：%w", err)
			}
			continue
		}
		if j.upload {
			err = uploadFile(ctx, root, remote, local, remotePath, entry.size, progress)
		} else {
			err = downloadFile(ctx, root, remote, remotePath, local, entry.size, progress)
		}
		if err != nil {
			return fmt.Errorf("傳輸 %s 失敗：%w", entry.relative, err)
		}
	}
	return nil
}
func uploadFile(ctx context.Context, root *os.Root, remote *pkgsftp.Client, local, destination string, expected int64, progress func(int64)) (err error) {
	src, err := root.Open(local)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("來源不是一般檔案")
	}
	if info.Size() != expected {
		return fmt.Errorf("來源大小已變更：預期 %d bytes，實際 %d bytes", expected, info.Size())
	}
	dst, err := remote.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = remote.Remove(destination)
		}
	}()
	var copied int64
	err = copyBytes(ctx, dst, src, func(n int64) { copied += n; progress(n) })
	if err == nil && copied != expected {
		err = fmt.Errorf("傳輸不完整：預期 %d bytes，實際 %d bytes", expected, copied)
	}
	closeErr := dst.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		saved, statErr := remote.Lstat(destination)
		if statErr != nil {
			err = fmt.Errorf("無法確認遠端檔案：%w", statErr)
		} else if !saved.Mode().IsRegular() || saved.Size() != expected {
			err = fmt.Errorf("遠端檔案驗證失敗：預期 %d bytes，實際 %d bytes", expected, saved.Size())
		}
	}
	return err
}
func downloadFile(ctx context.Context, root *os.Root, remote *pkgsftp.Client, source, local string, expected int64, progress func(int64)) (err error) {
	src, err := remote.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("來源不是一般檔案")
	}
	if info.Size() != expected {
		return fmt.Errorf("來源大小已變更：預期 %d bytes，實際 %d bytes", expected, info.Size())
	}
	dst, err := root.OpenFile(local, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = root.Remove(local)
		}
	}()
	var copied int64
	err = copyBytes(ctx, dst, src, func(n int64) { copied += n; progress(n) })
	if err == nil && copied != expected {
		err = fmt.Errorf("傳輸不完整：預期 %d bytes，實際 %d bytes", expected, copied)
	}
	closeErr := dst.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		saved, statErr := root.Lstat(local)
		if statErr != nil {
			err = fmt.Errorf("無法確認本機檔案：%w", statErr)
		} else if !saved.Mode().IsRegular() || saved.Size() != expected {
			err = fmt.Errorf("本機檔案驗證失敗：預期 %d bytes，實際 %d bytes", expected, saved.Size())
		}
	}
	return err
}
