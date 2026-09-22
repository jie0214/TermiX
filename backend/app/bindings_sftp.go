package app

import (
	"errors"
	sftpservice "github.com/jie0214/TermiX/backend/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) ConnectSFTP(hostID string) (sftpservice.Session, error) {
	if !a.beginOperation() {
		return sftpservice.Session{}, errors.New("正在準備結束或更新")
	}
	defer a.endOperation()
	return a.sftp.Connect(a.contextOrBackground(), hostID)
}
func (a *App) ListSFTPSessions() []sftpservice.Session { return a.sftp.Sessions() }
func (a *App) ListSFTPDirectory(id, path string) (sftpservice.Listing, error) {
	return a.sftp.List(id, path)
}
func (a *App) MutateSFTP(id, action, path, name string) error {
	if !a.beginOperation() {
		return errors.New("正在準備結束或更新")
	}
	defer a.endOperation()
	return a.sftp.Mutate(id, action, path, name)
}
func (a *App) DisconnectSFTP(id string) error            { return a.sftp.Disconnect(id) }
func (a *App) ListSFTPTransfers() []sftpservice.Transfer { return a.sftp.Transfers() }
func (a *App) ClearSFTPTransfers()                       { a.sftp.ClearCompleted() }
func (a *App) QueueSFTPUpload(id string, paths []string, destination string) error {
	if !a.beginOperation() {
		return errors.New("正在準備結束或更新")
	}
	defer a.endOperation()
	return a.sftp.Queue(id, "upload", paths, destination)
}
func (a *App) SelectSFTPUpload(id, destination string, directory bool) error {
	if !a.beginOperation() {
		return errors.New("正在準備結束或更新")
	}
	defer a.endOperation()
	options := runtime.OpenDialogOptions{Title: "選擇要上傳的檔案或資料夾"}
	var paths []string
	var err error
	if directory {
		var selected string
		selected, err = runtime.OpenDirectoryDialog(a.ctx, options)
		if selected != "" {
			paths = []string{selected}
		}
	} else {
		paths, err = runtime.OpenMultipleFilesDialog(a.ctx, options)
	}
	if err != nil {
		return err
	}
	return a.sftp.Queue(id, "upload", paths, destination)
}
func (a *App) DownloadSFTP(id string, paths []string) error {
	if !a.beginOperation() {
		return errors.New("正在準備結束或更新")
	}
	defer a.endOperation()
	destination, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "選擇下載目的資料夾"})
	if err != nil {
		return err
	}
	if destination == "" {
		return nil
	}
	return a.sftp.Queue(id, "download", paths, destination)
}

// ShutdownSFTP 僅由應用程式生命週期呼叫，不暴露為前端 binding。
func ShutdownSFTP(a *App) {
	if a.sftp != nil {
		a.sftp.CloseAll()
	}
}

func (a *App) ListSFTPLocalDirectory(path string) (sftpservice.LocalListing, error) {
	return sftpservice.ListLocalDirectory(path)
}
func (a *App) SelectSFTPLocalDirectory() (*sftpservice.LocalListing, error) {
	directory, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "選擇本機資料夾"})
	if err != nil {
		return nil, err
	}
	if directory == "" {
		return nil, nil
	}
	listing, err := sftpservice.ListLocalDirectory(directory)
	if err != nil {
		return nil, err
	}
	return &listing, nil
}
