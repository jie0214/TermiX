//go:build bindings

package storage

import (
	"database/sql"
	"fmt"
)

// provideDatabase 避免 Wails 產生 bindings 時存取使用者的正式資料庫。
func provideDatabase() (*Database, error) {
	db, err := sql.Open(
		"sqlite",
		"file:termix-bindings?mode=memory&cache=shared&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)",
	)
	if err != nil {
		return nil, fmt.Errorf("開啟 bindings 記憶體 SQLite 失敗：%w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("驗證 bindings 記憶體 SQLite 連線失敗：%w", err)
	}
	if err := runMigrations(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &Database{DB: db, Path: ":memory:"}, nil
}
