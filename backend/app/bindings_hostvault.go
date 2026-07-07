package app

import (
	"context"
	"os"
	"strings"
)

func (a *App) TestConnection(config SSHConfig) OperationResult {
	return a.sshConnector.TestConnection(config)
}

func (a *App) ListHostVault() OperationResult {
	snapshot, err := a.hostVault.GetSnapshot(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(snapshot)
}

func (a *App) ListHosts() OperationResult {
	hosts, err := a.hostVault.ListHosts(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(hosts)
}

func (a *App) GetHost(hostID string) OperationResult {
	host, err := a.hostVault.GetHost(a.contextOrBackground(), hostID)
	if err != nil {
		return failure(err)
	}
	return successJSON(host)
}

func (a *App) SaveHost(host HostProfile, secrets HostSecretsInput) OperationResult {
	saved, _, err := a.hostVault.SaveHost(a.contextOrBackground(), SaveHostRequest{
		Host:    host,
		Secrets: secrets,
	})
	if err != nil {
		return failure(err)
	}
	return successJSON(saved)
}

func (a *App) DeleteHost(hostID string) OperationResult {
	if err := a.hostVault.DeleteHost(a.contextOrBackground(), hostID); err != nil {
		return failure(err)
	}
	return success("deleted")
}

func (a *App) SaveHostGroup(group HostGroup) OperationResult {
	saved, err := a.hostVault.SaveGroup(a.contextOrBackground(), group)
	if err != nil {
		return failure(err)
	}
	return successJSON(saved)
}

func (a *App) ListHostGroups() OperationResult {
	groups, err := a.hostVault.ListGroups(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(groups)
}

func (a *App) DeleteHostGroup(groupID string) OperationResult {
	if err := a.hostVault.DeleteGroup(a.contextOrBackground(), groupID); err != nil {
		return failure(err)
	}
	return success("deleted")
}

func (a *App) GetHostSecretStatus(hostID string) OperationResult {
	status, err := a.hostVault.GetSecretStatus(a.contextOrBackground(), hostID)
	if err != nil {
		return failure(err)
	}
	return successJSON(status)
}

func (a *App) GetHostSecretValue(request HostSecretValueRequest) OperationResult {
	value, err := a.hostVault.GetSecretValue(a.contextOrBackground(), request)
	if err != nil {
		return failure(err)
	}
	return successJSON(value)
}

func (a *App) ConnectHost(hostID string) OperationResult {
	config, err := a.hostVault.ResolveRuntimeConfig(a.contextOrBackground(), HostConnectionRequest{HostID: hostID})
	if err != nil {
		return failure(err)
	}
	return a.terminal.Connect(config)
}

func (a *App) CancelConnectHost(hostID string) OperationResult {
	config, err := a.hostVault.ResolveRuntimeConfig(a.contextOrBackground(), HostConnectionRequest{HostID: hostID})
	if err != nil {
		return failure(err)
	}
	a.terminal.CancelConnect(config)
	return success("canceled")
}

func (a *App) TestHostConnection(hostID string) OperationResult {
	config, err := a.hostVault.ResolveRuntimeConfig(a.contextOrBackground(), HostConnectionRequest{HostID: hostID})
	if err != nil {
		return failure(err)
	}
	return a.sshConnector.TestConnection(config)
}

func (a *App) ExportHostsBackup(options HostExportOptions) OperationResult {
	exportData, err := a.hostVault.Export(a.contextOrBackground(), options)
	if err != nil {
		return failure(err)
	}
	return success(exportData)
}

func (a *App) ImportHostsBackup(payload string, options HostImportOptions) OperationResult {
	if strings.TrimSpace(payload) != "" && !strings.HasPrefix(strings.TrimSpace(payload), "{") && !strings.HasPrefix(strings.TrimSpace(payload), "[") && !strings.Contains(payload, "\n") {
		bytes, err := os.ReadFile(strings.TrimSpace(payload))
		if err == nil {
			payload = string(bytes)
		}
	}
	result, err := a.hostVault.Import(a.contextOrBackground(), payload, options)
	if err != nil {
		return failure(err)
	}
	return successJSON(result)
}

func (a *App) GetAppSettings() OperationResult {
	settings, err := a.hostVault.GetSettings(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(settings)
}

func (a *App) SaveAppSettings(settings AppSettings) OperationResult {
	saved, err := a.hostVault.SaveSettings(a.contextOrBackground(), settings)
	if err != nil {
		return failure(err)
	}
	return successJSON(saved)
}

func (a *App) ListAWSIntegrations() OperationResult {
	integrations, err := a.hostVault.ListAWSIntegrations(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(integrations)
}

func (a *App) GetAWSIntegration(groupID string) OperationResult {
	integration, err := a.hostVault.GetAWSIntegration(a.contextOrBackground(), groupID)
	if err != nil {
		return failure(err)
	}
	return successJSON(integration)
}

func (a *App) SaveAWSIntegration(integration AWSIntegration, secrets AWSIntegrationSecretsInput, previousGroupID string) OperationResult {
	saved, err := a.hostVault.SaveAWSIntegration(a.contextOrBackground(), SaveAWSIntegrationRequest{
		Integration:     integration,
		Secrets:         secrets,
		PreviousGroupID: previousGroupID,
	})
	if err != nil {
		return failure(err)
	}
	return successJSON(saved)
}

func (a *App) DeleteAWSIntegration(groupID string) OperationResult {
	if err := a.hostVault.DeleteAWSIntegration(a.contextOrBackground(), groupID); err != nil {
		return failure(err)
	}
	return success("deleted")
}

func (a *App) SyncAWS(groupID string) OperationResult {
	if err := a.hostVault.SyncAWS(a.contextOrBackground(), groupID); err != nil {
		return failure(err)
	}
	return success("synced")
}

func (a *App) ListGCPIntegrations() OperationResult {
	integrations, err := a.hostVault.ListGCPIntegrations(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(integrations)
}

func (a *App) GetGCPIntegration(groupID string) OperationResult {
	integration, err := a.hostVault.GetGCPIntegration(a.contextOrBackground(), groupID)
	if err != nil {
		return failure(err)
	}
	return successJSON(integration)
}

func (a *App) SaveGCPIntegration(integration GCPIntegration, secrets GCPIntegrationSecretsInput, previousGroupID string) OperationResult {
	saved, err := a.hostVault.SaveGCPIntegration(a.contextOrBackground(), SaveGCPIntegrationRequest{
		Integration:     integration,
		Secrets:         secrets,
		PreviousGroupID: previousGroupID,
	})
	if err != nil {
		return failure(err)
	}
	return successJSON(saved)
}

func (a *App) DeleteGCPIntegration(groupID string) OperationResult {
	if err := a.hostVault.DeleteGCPIntegration(a.contextOrBackground(), groupID); err != nil {
		return failure(err)
	}
	return success("deleted")
}

func (a *App) SyncGCP(groupID string) OperationResult {
	if err := a.hostVault.SyncGCP(a.contextOrBackground(), groupID); err != nil {
		return failure(err)
	}
	return success("synced")
}

func (a *App) contextOrBackground() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}
