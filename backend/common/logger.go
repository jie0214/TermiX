package common

import (
	"github.com/sirupsen/logrus"
	"os"
)

// Log 為全域結構化日誌實例
var Log *logrus.Logger

// InitLogger 初始化全域 JSON 結構化日誌格式與輸出目標
func InitLogger() {
	Log = logrus.New()
	Log.SetFormatter(&logrus.JSONFormatter{
		TimestampFormat: "2006-01-02 15:04:05.000",
	})
	Log.SetOutput(os.Stdout)
	Log.SetLevel(logrus.InfoLevel)
}

// DomainLogger 建立一個附帶指定領域標籤（Domain Tag）的結構化日誌記錄器
func DomainLogger(domain string) *logrus.Entry {
	if Log == nil {
		InitLogger()
	}
	return Log.WithField("domain", domain)
}
