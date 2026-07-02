package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jie0214/TermiX/backend/common"

	_ "modernc.org/sqlite"
)

var log = common.DomainLogger("storage")

type Database struct {
	DB   *sql.DB
	Path string
}

func NewDatabase() (*Database, error) {
	path, err := defaultDBPath()
	if err != nil {
		return nil, err
	}
	return OpenDatabase(path)
}

func OpenDatabase(path string) (*Database, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, fmt.Errorf("建立 SQLite 目錄失敗：%w", err)
	}

	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("開啟 SQLite 失敗：%w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("驗證 SQLite 連線失敗：%w", err)
	}
	if err := runMigrations(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	log.WithField("path", path).Info("SQLite 儲存層初始化完成")
	return &Database{
		DB:   db,
		Path: path,
	}, nil
}

func defaultDBPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		homeDir, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", fmt.Errorf("無法解析 SQLite 設定目錄：%w", err)
		}
		return filepath.Join(homeDir, ".termix", "termix.db"), nil
	}
	return filepath.Join(configDir, "TermiX", "termix.db"), nil
}
