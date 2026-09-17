package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenDatabaseUsesPrivatePermissionsAndRunsMigrations(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "nested", "termix.db")
	database, err := OpenDatabase(path)
	if err != nil {
		t.Fatalf("OpenDatabase 失敗：%v", err)
	}
	t.Cleanup(func() { _ = database.DB.Close() })

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("讀取 SQLite 檔案資訊失敗：%v", err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("SQLite 權限應為 0600，實際為 %04o", got)
	}

	for _, table := range []string{
		"host_groups", "hosts", "app_settings", "aws_integrations",
		"gcp_integrations", "keychain_keys", "kubernetes_clusters",
	} {
		var count int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil {
			t.Fatalf("查詢資料表 %s 失敗：%v", table, err)
		}
		if count != 1 {
			t.Fatalf("必要資料表未建立：%s", table)
		}
	}
}

func TestOpenDatabaseMigrationIsIdempotent(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "termix.db")
	first, err := OpenDatabase(path)
	if err != nil {
		t.Fatalf("第一次 OpenDatabase 失敗：%v", err)
	}
	if err := first.DB.Close(); err != nil {
		t.Fatalf("關閉第一次連線失敗：%v", err)
	}

	second, err := OpenDatabase(path)
	if err != nil {
		t.Fatalf("第二次 OpenDatabase 失敗：%v", err)
	}
	t.Cleanup(func() { _ = second.DB.Close() })

	for _, column := range []string{"aws_instance_id", "gcp_instance_id", "os_id", "keychain_key_id"} {
		if !databaseColumnExists(t, second, "hosts", column) {
			t.Fatalf("重入 migration 後缺少 hosts.%s", column)
		}
	}
}

func databaseColumnExists(t *testing.T, database *Database, table string, target string) bool {
	t.Helper()
	rows, err := database.DB.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		t.Fatalf("查詢 %s schema 失敗：%v", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatalf("讀取 %s schema 失敗：%v", table, err)
		}
		if name == target {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("巡覽 %s schema 失敗：%v", table, err)
	}
	return false
}
