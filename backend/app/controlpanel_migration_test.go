package app

import (
	"database/sql"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

func legacyFixture(t *testing.T, root, name, value string, production bool) string {
	t.Helper()
	dir := filepath.Join(root, name, name)
	if err := os.MkdirAll(filepath.Join(dir, "LocalStorage"), 0700); err != nil {
		t.Fatal(err)
	}
	origin := []byte{5, 0, 0, 0, 1, 'w', 'a', 'i', 'l', 's', 5, 0, 0, 0, 1, 'w', 'a', 'i', 'l', 's', 0}
	data := append(append([]byte{}, origin...), origin...)
	if !production {
		data = []byte("wails.localhost")
	}
	if err := os.WriteFile(filepath.Join(dir, "origin"), data, 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "LocalStorage", "localstorage.sqlite3")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)"); err != nil {
		t.Fatal(err)
	}
	units := utf16.Encode([]rune(value))
	raw := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], u)
	}
	if _, err = db.Exec("INSERT INTO ItemTable VALUES (?,?)", "termix-custom-components", raw); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLegacyControlPanelPreservesComponentsAndIgnoresDevOrigin(t *testing.T) {
	root := t.TempDir()
	want := `[{"id":"original","type":"function","name":"原始設定 😀"}]`
	path := legacyFixture(t, root, "old", want, true)
	legacyFixture(t, root, "development", `[{"id":"dev"}]`, false)
	before, _ := os.ReadFile(path)
	got, err := readLegacyControlPanel(root)
	if err != nil || got != want {
		t.Fatalf("舊組件未完整還原：%v", err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("不應修改舊資料庫")
	}
}

func TestLegacyControlPanelMissingAndConflictingSources(t *testing.T) {
	root := t.TempDir()
	if got, err := readLegacyControlPanel(filepath.Join(root, "absent")); err != nil || got != "" {
		t.Fatal("無舊資料應略過")
	}
	legacyFixture(t, root, "one", `[{"id":"one"}]`, true)
	legacyFixture(t, root, "two", `[{"id":"two"}]`, true)
	if _, err := readLegacyControlPanel(root); err == nil {
		t.Fatal("資料來源衝突時必須停止")
	}
}

func TestLegacyControlPanelOlderWebKitLayout(t *testing.T) {
	root := t.TempDir()
	want := `[{"id":"older-mac","type":"info"}]`
	original := legacyFixture(t, root, "fixture", want, true)
	dir := filepath.Join(root, "LocalStorage")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(original, filepath.Join(dir, "wails_wails_0.localstorage")); err != nil {
		t.Fatal(err)
	}
	got, err := readLegacyControlPanel(root)
	if err != nil || got != want {
		t.Fatalf("舊 WebKit 格式未還原：%v", err)
	}
}

func TestLegacyWebSettingsReadsTextAndLeavesUnrelatedKeysAlone(t *testing.T) {
	root := t.TempDir()
	path := legacyFixture(t, root, "production", `[]`, true)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("INSERT INTO ItemTable VALUES (?,?)", "termix-global-settings", `{"theme":"light"}`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	got, err := readLegacyWebValue(root, "termix-global-settings")
	if err != nil || got != `{"theme":"light"}` {
		t.Fatalf("文字偏好未還原：%v", err)
	}
}
