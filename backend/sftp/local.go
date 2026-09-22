package sftp

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type LocalEntry struct {
	Entry
	Path string `json:"path"`
}
type LocalListing struct {
	Path    string       `json:"path"`
	Parent  string       `json:"parent"`
	Entries []LocalEntry `json:"entries"`
}

// ListLocalDirectory 只讀取目錄中繼資料，不讀取檔案內容；路徑運算由後端依作業系統處理。
func ListLocalDirectory(directory string) (LocalListing, error) {
	var err error
	if directory == "" {
		directory, err = os.UserHomeDir()
		if err != nil {
			return LocalListing{}, err
		}
	}
	if !filepath.IsAbs(directory) || strings.ContainsRune(directory, 0) {
		return LocalListing{}, errors.New("請指定本機絕對路徑")
	}
	directory, err = filepath.EvalSymlinks(filepath.Clean(directory))
	if err != nil {
		return LocalListing{}, err
	}
	children, err := os.ReadDir(directory)
	if err != nil {
		return LocalListing{}, err
	}
	result := LocalListing{Path: directory, Parent: filepath.Dir(directory), Entries: make([]LocalEntry, 0, len(children))}
	for _, child := range children {
		info, err := child.Info()
		if err != nil {
			return LocalListing{}, err
		}
		kind := "file"
		if info.IsDir() {
			kind = "directory"
		} else if info.Mode()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if !info.Mode().IsRegular() {
			kind = "special"
		}
		result.Entries = append(result.Entries, LocalEntry{Entry: Entry{Name: info.Name(), Type: kind, Size: info.Size(), Modified: info.ModTime().UnixMilli(), Permissions: info.Mode().String()}, Path: filepath.Join(directory, info.Name())})
	}
	sort.Slice(result.Entries, func(i, j int) bool {
		a, b := result.Entries[i], result.Entries[j]
		if (a.Type == "directory") != (b.Type == "directory") {
			return a.Type == "directory"
		}
		return a.Name < b.Name
	})
	return result, nil
}
