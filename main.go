package main

import (
	"context"
	"embed"
	"os"
	"runtime"
	"strings"
	"time"

	termixapp "github.com/jie0214/TermiX/backend/app"
	"github.com/jie0214/TermiX/backend/controlpanel"
	"github.com/jie0214/TermiX/backend/hostvault"
	"github.com/jie0214/TermiX/backend/knownhosts"
	"github.com/jie0214/TermiX/backend/kubernetes"
	"github.com/jie0214/TermiX/backend/secrets"
	"github.com/jie0214/TermiX/backend/snippets"
	"github.com/jie0214/TermiX/backend/ssh"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/backend/terminal"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"go.uber.org/fx"
)

func init() {
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		path := os.Getenv("PATH")
		paths := []string{
			"/opt/homebrew/bin",
			"/usr/local/bin",
		}

		currentPaths := strings.Split(path, string(os.PathListSeparator))
		pathMap := make(map[string]bool)
		for _, p := range currentPaths {
			pathMap[p] = true
		}

		newPaths := append([]string{}, currentPaths...)
		for _, p := range paths {
			if !pathMap[p] && isDir(p) {
				newPaths = append(newPaths, p)
			}
		}

		if len(newPaths) > len(currentPaths) {
			os.Setenv("PATH", strings.Join(newPaths, string(os.PathListSeparator)))
		}
	}
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

//go:embed all:frontend/dist
var assets embed.FS

// version 由建置時透過 -ldflags "-X main.version=X.Y.Z" 注入；預設 dev。
var version = "dev"

func main() {
	termixapp.Version = version

	var app *termixapp.App

	fxApp := fx.New(
		knownhosts.Module,
		storage.Module,
		secrets.Module,
		ssh.Module,
		terminal.Module,
		controlpanel.Module,
		snippets.Module,
		hostvault.Module,
		kubernetes.Module,
		fx.Provide(termixapp.NewApp),
		fx.Populate(&app),
		fx.NopLogger, // 靜默 Fx 啟動日誌，保持終端乾淨
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := fxApp.Start(ctx); err != nil {
		panic(err)
	}
	defer fxApp.Stop(context.Background())

	appMenu := termixapp.NewMenu(app)

	err := wails.Run(&options.App{
		Title:     "TermiX",
		Width:     1360,
		Height:    900,
		MinWidth:  980,
		MinHeight: 680,
		Menu:      appMenu,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.Startup,
		Bind: []interface{}{
			app,
		},
		Debug: options.Debug{
			OpenInspectorOnStartup: false,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
