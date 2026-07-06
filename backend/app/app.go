package app

import (
	"context"
	"github.com/jie0214/TermiX/backend/controlpanel"
	"github.com/jie0214/TermiX/backend/hostvault"
	"github.com/jie0214/TermiX/backend/keychain"
	"github.com/jie0214/TermiX/backend/kubernetes"
	"github.com/jie0214/TermiX/backend/snippets"
	termixssh "github.com/jie0214/TermiX/backend/ssh"
	"github.com/jie0214/TermiX/backend/terminal"
)

func NewApp(termMgr *terminal.Manager, ctrlPanel *controlpanel.Executor, sshConn *termixssh.Connector, snippetsSvc *snippets.Service, hostVaultSvc *hostvault.Service, kubernetesSvc *kubernetes.Service, keychainSvc *keychain.Service) *App {
	return &App{
		terminal:     termMgr,
		controlPanel: ctrlPanel,
		sshConnector: sshConn,
		snippets:     snippetsSvc,
		hostVault:    hostVaultSvc,
		kubernetes:   kubernetesSvc,
		keychain:     keychainSvc,
	}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.terminal.SetContext(ctx)
}
