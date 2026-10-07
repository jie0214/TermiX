package app

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const projectGitHubURL = "https://github.com/jie0214/TermiX"

func showAbout(version string, dialog func(runtime.MessageDialogOptions) (string, error), openURL func(string)) {
	label := version
	if label == "" || label == "dev" {
		label = "開發版本（dev）"
	}
	answer, err := dialog(runtime.MessageDialogOptions{
		Type:          runtime.InfoDialog,
		Title:         "關於 TermiX",
		Message:       fmt.Sprintf("TermiX\n目前版本：%s\n\nGitHub：%s", label, projectGitHubURL),
		Buttons:       []string{"關閉", "開啟 GitHub"},
		DefaultButton: "關閉", CancelButton: "關閉",
	})
	if err == nil && answer == "開啟 GitHub" {
		openURL(projectGitHubURL)
	}
}
