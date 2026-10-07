package app

import (
	"errors"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"strings"
	"testing"
)

func TestAboutMenuOpensDialog(t *testing.T) {
	called := false
	menu := newMenu(&App{}, func() { called = true })
	menu.Items[0].SubMenu.Items[0].Click(nil)
	if !called {
		t.Fatal("點擊關於 TermiX 未開啟對話框")
	}
}

func TestAboutShowsBuildVersionAndOpensOnlyRequestedGitHub(t *testing.T) {
	for _, tc := range []struct {
		version, answer string
		fail, open      bool
	}{
		{"1.10.0", "開啟 GitHub", false, true}, {"1.10.0", "關閉", false, false}, {"dev", "", false, false}, {"1.10.0", "開啟 GitHub", true, false},
	} {
		opened := false
		showAbout(tc.version, func(options runtime.MessageDialogOptions) (string, error) {
			if !strings.Contains(options.Message, tc.version) || !strings.Contains(options.Message, projectGitHubURL) {
				t.Fatalf("缺少版本或 GitHub：%s", options.Message)
			}
			if options.CancelButton != "關閉" {
				t.Fatal("取消按鈕不正確")
			}
			if tc.fail {
				return tc.answer, errors.New("對話框失敗")
			}
			return tc.answer, nil
		}, func(url string) {
			opened = true
			if url != projectGitHubURL {
				t.Fatalf("錯誤網址：%s", url)
			}
		})
		if opened != tc.open {
			t.Fatalf("開啟 GitHub = %v，預期 %v", opened, tc.open)
		}
	}
}
