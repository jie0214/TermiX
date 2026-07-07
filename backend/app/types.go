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
	"github.com/jie0214/TermiX/shared/dto"
	"time"
)

const (
	defaultTimeout = 45 * time.Second
)

type App struct {
	ctx          context.Context
	terminal     *terminal.Manager
	controlPanel *controlpanel.Executor
	sshConnector *termixssh.Connector
	snippets     *snippets.Service
	hostVault    *hostvault.Service
	kubernetes   *kubernetes.Service
	keychain     *keychain.Service
}

type SSHConfig = dto.SSHConfig
type TerminalCommandRequest = dto.TerminalCommandRequest

type OperationResult = dto.OperationResult
type AutocompleteResult = dto.AutocompleteResult
type Snippet = dto.Snippet
type SnippetUpsertRequest = dto.SnippetUpsertRequest
type HostStartupSnippet = dto.HostStartupSnippet
type HostStartupSnippetRequest = dto.HostStartupSnippetRequest
type ExecuteSnippetBatchRequest = dto.ExecuteSnippetBatchRequest
type SnippetBatchResult = dto.SnippetBatchResult
type HostProfile = dto.HostProfile
type HostGroup = dto.HostGroup
type SaveHostRequest = dto.SaveHostRequest
type HostSecretsInput = dto.HostSecretsInput
type HostSecretStatus = dto.HostSecretStatus
type HostSecretValueRequest = dto.HostSecretValueRequest
type HostSecretValue = dto.HostSecretValue
type HostVaultSnapshot = dto.HostVaultSnapshot
type HostExportOptions = dto.HostExportOptions
type HostImportOptions = dto.HostImportOptions
type HostImportResult = dto.HostImportResult
type HostConnectionRequest = dto.HostConnectionRequest
type AppSettings = dto.AppSettings

type KeychainKey = dto.KeychainKey
type GenerateKeychainKeyRequest = dto.GenerateKeychainKeyRequest
type ImportKeychainKeyRequest = dto.ImportKeychainKeyRequest
type ExportKeychainKeyRequest = dto.ExportKeychainKeyRequest
type ExportedKeychainKey = dto.ExportedKeychainKey

type AWSIntegration = dto.AWSIntegration
type AWSIntegrationSecretsInput = dto.AWSIntegrationSecretsInput
type SaveAWSIntegrationRequest = dto.SaveAWSIntegrationRequest
type GCPIntegration = dto.GCPIntegration
type GCPIntegrationSecretsInput = dto.GCPIntegrationSecretsInput
type SaveGCPIntegrationRequest = dto.SaveGCPIntegrationRequest
type KubernetesClusterProfile = dto.KubernetesClusterProfile
type KubernetesContextSwitchRequest = dto.KubernetesContextSwitchRequest
type KubernetesConnectRequest = dto.KubernetesConnectRequest
type KubernetesSession = dto.KubernetesSession
type KubernetesDashboardRequest = dto.KubernetesDashboardRequest
type KubernetesDashboardSnapshot = dto.KubernetesDashboardSnapshot
type KubernetesResourceDetailRequest = dto.KubernetesResourceDetailRequest
type KubernetesResourceDetail = dto.KubernetesResourceDetail
type KubernetesPodLogsRequest = dto.KubernetesPodLogsRequest
type KubernetesPodLogs = dto.KubernetesPodLogs
type KubernetesPodShellStartRequest = dto.KubernetesPodShellStartRequest
type KubernetesPodShellSessionRequest = dto.KubernetesPodShellSessionRequest
type KubernetesPodShellSession = dto.KubernetesPodShellSession
type KubernetesPodDeleteRequest = dto.KubernetesPodDeleteRequest
type KubernetesResourceDeleteRequest = dto.KubernetesResourceDeleteRequest
type KubernetesPodPortForwardRequest = dto.KubernetesPodPortForwardRequest
type KubernetesPodPortForwardListRequest = dto.KubernetesPodPortForwardListRequest
type KubernetesPodPortForwardStopRequest = dto.KubernetesPodPortForwardStopRequest
type KubernetesPodPortForward = dto.KubernetesPodPortForward
type KubernetesResourceCreateRequest = dto.KubernetesResourceCreateRequest
type KubernetesResourceCreateResult = dto.KubernetesResourceCreateResult
type KubernetesResourceUpdateRequest = dto.KubernetesResourceUpdateRequest
