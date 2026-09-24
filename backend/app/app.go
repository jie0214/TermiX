package app

import (
	"context"
	"github.com/jie0214/TermiX/backend/controlpanel"
	"github.com/jie0214/TermiX/backend/hostvault"
	"github.com/jie0214/TermiX/backend/keychain"
	"github.com/jie0214/TermiX/backend/kubernetes"
	"github.com/jie0214/TermiX/backend/mobilecloud"
	sftpservice "github.com/jie0214/TermiX/backend/sftp"
	"github.com/jie0214/TermiX/backend/snippets"
	termixssh "github.com/jie0214/TermiX/backend/ssh"
	"github.com/jie0214/TermiX/backend/terminal"
)

func NewApp(termMgr *terminal.Manager, ctrlPanel *controlpanel.Executor, sshConn *termixssh.Connector, snippetsSvc *snippets.Service, hostVaultSvc *hostvault.Service, kubernetesSvc *kubernetes.Service, keychainSvc *keychain.Service) *App {
	return &App{
		mobileCloud:  mobilecloud.NewService(hostVaultSvc, mobilecloud.Publish, mobilecloud.Capability),
		terminal:     termMgr,
		sftp:         sftpservice.NewManager(sshConn, hostVaultSvc),
		controlPanel: ctrlPanel,
		sshConnector: sshConn,
		snippets:     snippetsSvc,
		hostVault:    hostVaultSvc,
		kubernetes:   kubernetesSvc,
		keychain:     keychainSvc,
	}
}

// Initialize 在 Wails 生命週期開始時設定執行期 Context。
// 採用 package function，避免 context.Context 被產生為前端可呼叫的 binding。
func Initialize(a *App, ctx context.Context) {
	a.ctx = ctx
	cloudContext, cancel := context.WithCancel(ctx)
	a.mobileCloudCancel = cancel
	go a.mobileCloud.Run(cloudContext)
	a.terminal.SetContext(ctx)
}

// ShutdownMobileSync 停止下一輪自動同步。
func ShutdownMobileSync(a *App) {
	if a.mobileCloudCancel != nil {
		a.mobileCloudCancel()
	}
}
