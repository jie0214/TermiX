package storage

import (
	"database/sql"
	"fmt"
)

func runMigrations(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS host_groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			order_index INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS hosts (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			alias TEXT NOT NULL DEFAULT '',
			group_id TEXT REFERENCES host_groups(id) ON DELETE SET NULL,
			aws_instance_id TEXT DEFAULT '',
			host TEXT NOT NULL,
			port INTEGER NOT NULL,
			username TEXT NOT NULL,
			auth_mode TEXT NOT NULL,
			private_key_path TEXT NOT NULL DEFAULT '',
			cert_path TEXT NOT NULL DEFAULT '',
			ssh_password_ref TEXT NOT NULL DEFAULT '',
			key_passphrase_ref TEXT NOT NULL DEFAULT '',
			sudo_password_ref TEXT NOT NULL DEFAULT '',
			show_snippets_in_control_panel INTEGER NOT NULL DEFAULT 1,
			startup_snippet_ids_json TEXT NOT NULL DEFAULT '[]',
			startup_command_mode TEXT NOT NULL DEFAULT 'none',
			startup_command_text TEXT NOT NULL DEFAULT '',
			custom_components_json TEXT NOT NULL DEFAULT '[]',
			enable_custom_query INTEGER NOT NULL DEFAULT 0,
			custom_query_script TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS app_settings (
			key TEXT PRIMARY KEY,
			value_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS aws_integrations (
			group_id TEXT PRIMARY KEY REFERENCES host_groups(id) ON DELETE CASCADE,
			name TEXT NOT NULL DEFAULT '',
			region TEXT NOT NULL,
			access_key_id TEXT NOT NULL,
			secret_access_key_ref TEXT NOT NULL,
			default_password_ref TEXT NOT NULL DEFAULT '',
			import_source TEXT NOT NULL,
			ip_address_type TEXT NOT NULL,
			default_port INTEGER NOT NULL DEFAULT 22,
			default_username TEXT NOT NULL,
			auth_mode TEXT NOT NULL,
			private_key_path TEXT NOT NULL DEFAULT '',
			cert_path TEXT NOT NULL DEFAULT '',
			last_sync_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS deleted_aws_instances (
			aws_instance_id TEXT PRIMARY KEY,
			group_id TEXT NOT NULL REFERENCES host_groups(id) ON DELETE CASCADE,
			deleted_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS kubernetes_clusters (
			id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			kubeconfig_path TEXT NOT NULL,
			context_name TEXT NOT NULL,
			cluster_name TEXT NOT NULL,
			server TEXT NOT NULL DEFAULT '',
			user_name TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			certificate_authority TEXT NOT NULL DEFAULT '',
			insecure_skip_tls_verify INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE(kubeconfig_path, context_name)
		);`,
	}

	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("執行 SQLite migration 失敗：%w", err)
		}
	}

	// 安全地為已存在的 hosts 表新增 aws_instance_id 欄位
	var hasAWSInstanceID bool
	rows, err := db.Query("PRAGMA table_info(hosts)")
	if err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull int
			var dfltValue interface{}
			var pk int
			if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err == nil {
				if name == "aws_instance_id" {
					hasAWSInstanceID = true
					break
				}
			}
		}
		if closeErr := rows.Close(); closeErr != nil {
			return fmt.Errorf("關閉 hosts schema 查詢失敗：%w", closeErr)
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return fmt.Errorf("讀取 hosts schema 失敗：%w", rowsErr)
		}
	}
	if !hasAWSInstanceID {
		if _, err := db.Exec("ALTER TABLE hosts ADD COLUMN aws_instance_id TEXT DEFAULT '';"); err != nil {
			return fmt.Errorf("無法新增 aws_instance_id 欄位：%w", err)
		}
	}

	if err := ensureColumn(db, "aws_integrations", "name", "ALTER TABLE aws_integrations ADD COLUMN name TEXT NOT NULL DEFAULT '';"); err != nil {
		return err
	}

	if err := ensureColumn(db, "aws_integrations", "default_password_ref", "ALTER TABLE aws_integrations ADD COLUMN default_password_ref TEXT NOT NULL DEFAULT '';"); err != nil {
		return err
	}

	return nil
}

func ensureColumn(db *sql.DB, tableName string, columnName string, alterStmt string) error {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", tableName))
	if err != nil {
		return fmt.Errorf("讀取 %s schema 失敗：%w", tableName, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dfltValue interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("讀取 %s 欄位資訊失敗：%w", tableName, err)
		}
		if name == columnName {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("讀取 %s schema 失敗：%w", tableName, err)
	}
	if _, err := db.Exec(alterStmt); err != nil {
		return fmt.Errorf("新增 %s.%s 欄位失敗：%w", tableName, columnName, err)
	}
	return nil
}
