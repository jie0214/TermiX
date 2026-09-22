package sftp

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListLocalDirectoryMetadataAndNavigation(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "資料夾"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a 空格.txt"), []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := ListLocalDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != canonical || result.Parent != filepath.Dir(canonical) {
		t.Fatalf("本機路徑不符：%+v", result)
	}
	if len(result.Entries) != 3 || result.Entries[0].Type != "directory" {
		t.Fatalf("本機排序或項目遺漏：%+v", result)
	}
	file := result.Entries[2]
	if file.Name != "a 空格.txt" || file.Size != 3 || file.Type != "file" || file.Permissions == "" || file.Modified == 0 || file.Path != filepath.Join(canonical, file.Name) {
		t.Fatalf("檔案中繼資料不符：%+v", file)
	}
	child, err := ListLocalDirectory(filepath.Join(root, "資料夾"))
	if err != nil {
		t.Fatal(err)
	}
	if child.Parent != canonical || child.Entries == nil || len(child.Entries) != 0 {
		t.Fatalf("空目錄或上層路徑不符：%+v", child)
	}
}
func TestListLocalDirectoryRejectsInvalidPaths(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "file")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"relative/path", filepath.Join(root, "missing"), file, root + "\x00"} {
		if _, err := ListLocalDirectory(p); err == nil {
			t.Errorf("無效路徑應失敗：%q", p)
		}
	}
}
func TestListLocalDirectoryDoesNotFollowChildSymlinks(t *testing.T) {
	root := t.TempDir()
	target := t.TempDir()
	if err := os.Symlink(target, filepath.Join(root, "link")); err != nil {
		t.Skipf("系統不支援測試用符號連結：%v", err)
	}
	listing, err := ListLocalDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 1 || listing.Entries[0].Type != "symlink" {
		t.Fatal("符號連結未標示")
	}
	selected, err := ListLocalDirectory(filepath.Join(root, "link"))
	if err != nil {
		t.Fatal(err)
	}
	canonical, _ := filepath.EvalSymlinks(target)
	if selected.Path != canonical {
		t.Fatal("明確指定的目錄連結未解析為實際路徑")
	}
}
