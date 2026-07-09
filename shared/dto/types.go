package dto

import "encoding/json"

type SSHConfig struct {
	Host              string `json:"host"`
	Port              int    `json:"port"`
	Username          string `json:"username"`
	AuthMode          string `json:"authMode"`
	Password          string `json:"password"`
	PrivateKeyPath    string `json:"privateKeyPath"`
	PrivateKeyData    string `json:"privateKeyData"` // 執行期由 keychain 解析出的 OpenSSH 私鑰內容；非空時優先於 PrivateKeyPath
	CertPath          string `json:"certPath"`
	SudoPassword      string `json:"sudoPassword"`
	SessionID         string `json:"sessionId"`
	EnableCustomQuery bool   `json:"enableCustomQuery"`
	CustomQueryScript string `json:"customQueryScript"`
}

type HostSecretRefs struct {
	SSHPasswordRef   string `json:"sshPasswordRef" yaml:"sshPasswordRef"`
	KeyPassphraseRef string `json:"keyPassphraseRef" yaml:"keyPassphraseRef"`
	SudoPasswordRef  string `json:"sudoPasswordRef" yaml:"sudoPasswordRef"`
}

type HostCustomComponent struct {
	ID      string `json:"id" yaml:"id"`
	Visible bool   `json:"visible" yaml:"visible"`
	Order   int    `json:"order" yaml:"order"`
}

type PersistedHostConfig struct {
	Host                       string                `json:"host" yaml:"host"`
	Port                       int                   `json:"port" yaml:"port"`
	Username                   string                `json:"username" yaml:"username"`
	AuthMode                   string                `json:"authMode" yaml:"authMode"`
	PrivateKeyPath             string                `json:"privateKeyPath" yaml:"privateKeyPath"`
	KeychainKeyID              string                `json:"keychainKeyId" yaml:"keychainKeyId"` // 選用：改用 Keychain 儲存的金鑰，優先於 PrivateKeyPath
	CertPath                   string                `json:"certPath" yaml:"certPath"`
	SecretRefs                 HostSecretRefs        `json:"secretRefs" yaml:"secretRefs"`
	ShowSnippetsInControlPanel bool                  `json:"showSnippetsInControlPanel" yaml:"showSnippetsInControlPanel"`
	StartupSnippetIDs          []string              `json:"startupSnippetIds" yaml:"startupSnippetIds"`
	StartupCommandMode         string                `json:"startupCommandMode" yaml:"startupCommandMode"`
	StartupCommandText         string                `json:"startupCommandText" yaml:"startupCommandText"`
	CustomComponents           []HostCustomComponent `json:"customComponents" yaml:"customComponents"`
	EnableCustomQuery          bool                  `json:"enableCustomQuery" yaml:"enableCustomQuery"`
	CustomQueryScript          string                `json:"customQueryScript" yaml:"customQueryScript"`
}

type HostProfile struct {
	ID            string              `json:"id" yaml:"id"`
	Label         string              `json:"label" yaml:"label"`
	Alias         string              `json:"alias" yaml:"alias"`
	GroupID       string              `json:"groupId" yaml:"groupId"`
	AWSInstanceID string              `json:"awsInstanceId" yaml:"awsInstanceId"`
	GCPInstanceID string              `json:"gcpInstanceId" yaml:"gcpInstanceId"`
	OSID          string              `json:"osId" yaml:"osId"`
	Config        PersistedHostConfig `json:"config" yaml:"config"`
	CreatedAt     string              `json:"createdAt" yaml:"createdAt"`
	UpdatedAt     string              `json:"updatedAt" yaml:"updatedAt"`
}

type HostGroup struct {
	ID        string `json:"id" yaml:"id"`
	Name      string `json:"name" yaml:"name"`
	ParentID  string `json:"parentId" yaml:"parentId"`
	Order     int    `json:"order" yaml:"order"`
	CreatedAt string `json:"createdAt" yaml:"createdAt"`
	UpdatedAt string `json:"updatedAt" yaml:"updatedAt"`
}

type AWSIntegration struct {
	GroupID            string `json:"groupId" yaml:"groupId"`
	Name               string `json:"name" yaml:"name"`
	Region             string `json:"region" yaml:"region"`
	AccessKeyID        string `json:"accessKeyId" yaml:"accessKeyId"`
	SecretAccessKeyRef string `json:"secretAccessKeyRef" yaml:"secretAccessKeyRef"`
	DefaultPasswordRef string `json:"defaultPasswordRef" yaml:"defaultPasswordRef"`
	ImportSource       string `json:"importSource" yaml:"importSource"`   // "ec2" | "lightsail" | "both"
	IPAddressType      string `json:"ipAddressType" yaml:"ipAddressType"` // "public" | "private"
	DefaultPort        int    `json:"defaultPort" yaml:"defaultPort"`
	DefaultUsername    string `json:"defaultUsername" yaml:"defaultUsername"`
	AuthMode           string `json:"authMode" yaml:"authMode"`
	PrivateKeyPath     string `json:"privateKeyPath" yaml:"privateKeyPath"`
	CertPath           string `json:"certPath" yaml:"certPath"`
	LastSyncAt         string `json:"lastSyncAt" yaml:"lastSyncAt"`
	CreatedAt          string `json:"createdAt" yaml:"createdAt"`
	UpdatedAt          string `json:"updatedAt" yaml:"updatedAt"`
}

type AWSIntegrationSecretsInput struct {
	SecretAccessKey SecretValueInput `json:"secretAccessKey" yaml:"secretAccessKey"`
	DefaultPassword SecretValueInput `json:"defaultPassword" yaml:"defaultPassword"`
}

type SaveAWSIntegrationRequest struct {
	Integration     AWSIntegration             `json:"integration" yaml:"integration"`
	Secrets         AWSIntegrationSecretsInput `json:"secrets" yaml:"secrets"`
	PreviousGroupID string                     `json:"previousGroupId" yaml:"previousGroupId"`
}

type GCPIntegration struct {
	GroupID               string `json:"groupId" yaml:"groupId"`
	Name                  string `json:"name" yaml:"name"`
	ProjectID             string `json:"projectId" yaml:"projectId"`
	ServiceAccountJSONRef string `json:"serviceAccountJsonRef" yaml:"serviceAccountJsonRef"`
	DefaultPasswordRef    string `json:"defaultPasswordRef" yaml:"defaultPasswordRef"`
	IPAddressType         string `json:"ipAddressType" yaml:"ipAddressType"` // "public" | "private"
	DefaultPort           int    `json:"defaultPort" yaml:"defaultPort"`
	DefaultUsername       string `json:"defaultUsername" yaml:"defaultUsername"`
	AuthMode              string `json:"authMode" yaml:"authMode"`
	PrivateKeyPath        string `json:"privateKeyPath" yaml:"privateKeyPath"`
	CertPath              string `json:"certPath" yaml:"certPath"`
	LastSyncAt            string `json:"lastSyncAt" yaml:"lastSyncAt"`
	CreatedAt             string `json:"createdAt" yaml:"createdAt"`
	UpdatedAt             string `json:"updatedAt" yaml:"updatedAt"`
}

type GCPIntegrationSecretsInput struct {
	ServiceAccountJSON SecretValueInput `json:"serviceAccountJson" yaml:"serviceAccountJson"`
	DefaultPassword    SecretValueInput `json:"defaultPassword" yaml:"defaultPassword"`
}

type SaveGCPIntegrationRequest struct {
	Integration     GCPIntegration             `json:"integration" yaml:"integration"`
	Secrets         GCPIntegrationSecretsInput `json:"secrets" yaml:"secrets"`
	PreviousGroupID string                     `json:"previousGroupId" yaml:"previousGroupId"`
}

type SecretValueInput struct {
	Ref      string `json:"ref" yaml:"ref"`
	Value    string `json:"value" yaml:"value"`
	HasValue bool   `json:"hasValue" yaml:"hasValue"`
	Clear    bool   `json:"clear" yaml:"clear"`
}

type HostSecretsInput struct {
	SSHPassword   SecretValueInput `json:"sshPassword" yaml:"sshPassword"`
	KeyPassphrase SecretValueInput `json:"keyPassphrase" yaml:"keyPassphrase"`
	SudoPassword  SecretValueInput `json:"sudoPassword" yaml:"sudoPassword"`
}

type SaveHostRequest struct {
	Host    HostProfile      `json:"host" yaml:"host"`
	Secrets HostSecretsInput `json:"secrets" yaml:"secrets"`
}

type SecretStatusEntry struct {
	Ref        string `json:"ref" yaml:"ref"`
	Configured bool   `json:"configured" yaml:"configured"`
	Stored     bool   `json:"stored" yaml:"stored"`
	Length     int    `json:"length" yaml:"length"`
}

type HostSecretStatus struct {
	HostID         string            `json:"hostId" yaml:"hostId"`
	SSHPassword    SecretStatusEntry `json:"sshPassword" yaml:"sshPassword"`
	KeyPassphrase  SecretStatusEntry `json:"keyPassphrase" yaml:"keyPassphrase"`
	SudoPassword   SecretStatusEntry `json:"sudoPassword" yaml:"sudoPassword"`
	OverallHealthy bool              `json:"overallHealthy" yaml:"overallHealthy"`
}

type HostSecretValueRequest struct {
	HostID string `json:"hostId" yaml:"hostId"`
	Field  string `json:"field" yaml:"field"`
}

type HostSecretValue struct {
	HostID string `json:"hostId" yaml:"hostId"`
	Field  string `json:"field" yaml:"field"`
	Value  string `json:"value" yaml:"value"`
	Found  bool   `json:"found" yaml:"found"`
}

// KeychainKey 為集中管理的 SSH 金鑰中繼資料；私鑰內容存於 OS Credential Store，不會出現在此結構。
type KeychainKey struct {
	ID            string `json:"id" yaml:"id"`
	Label         string `json:"label" yaml:"label"`
	Type          string `json:"type" yaml:"type"` // "ed25519" | "ecdsa" | "rsa"
	Bits          int    `json:"bits" yaml:"bits"` // ecdsa 曲線位元或 rsa 金鑰長度；ed25519 為 0
	PublicKey     string `json:"publicKey" yaml:"publicKey"`
	Fingerprint   string `json:"fingerprint" yaml:"fingerprint"`
	Comment       string `json:"comment" yaml:"comment"`
	HasPassphrase bool   `json:"hasPassphrase" yaml:"hasPassphrase"`
	PrivateKeyRef string `json:"privateKeyRef" yaml:"privateKeyRef"`
	CreatedAt     string `json:"createdAt" yaml:"createdAt"`
	UpdatedAt     string `json:"updatedAt" yaml:"updatedAt"`
}

type GenerateKeychainKeyRequest struct {
	Label      string `json:"label" yaml:"label"`
	Type       string `json:"type" yaml:"type"`
	Bits       int    `json:"bits" yaml:"bits"`
	Comment    string `json:"comment" yaml:"comment"`
	Passphrase string `json:"passphrase" yaml:"passphrase"`
}

type ImportKeychainKeyRequest struct {
	Label      string `json:"label" yaml:"label"`
	PrivateKey string `json:"privateKey" yaml:"privateKey"`
	Comment    string `json:"comment" yaml:"comment"`
	Passphrase string `json:"passphrase" yaml:"passphrase"` // 用於解開受保護的匯入私鑰
}

type ExportKeychainKeyRequest struct {
	ID             string `json:"id" yaml:"id"`
	IncludePrivate bool   `json:"includePrivate" yaml:"includePrivate"` // true 時回傳私鑰內容（維持其加密狀態）
}

type ExportedKeychainKey struct {
	Label      string `json:"label" yaml:"label"`
	PublicKey  string `json:"publicKey" yaml:"publicKey"`
	PrivateKey string `json:"privateKey" yaml:"privateKey"`
}

type AppSettings map[string]json.RawMessage

// KubernetesClusterProfile 以 kubeconfig Context 為操作單位，且不包含任何認證秘密。
type KubernetesClusterProfile struct {
	ID                    string `json:"id" yaml:"id"`
	DisplayName           string `json:"displayName" yaml:"displayName"`
	ContextName           string `json:"contextName" yaml:"contextName"`
	ClusterName           string `json:"clusterName" yaml:"clusterName"`
	Server                string `json:"server" yaml:"server"`
	UserName              string `json:"userName" yaml:"userName"`
	Namespace             string `json:"namespace" yaml:"namespace"`
	CertificateAuthority  string `json:"certificateAuthority" yaml:"certificateAuthority"`
	InsecureSkipTLSVerify bool   `json:"insecureSkipTLSVerify" yaml:"insecureSkipTLSVerify"`
	Source                string `json:"source" yaml:"source"`
	IsCurrent             bool   `json:"isCurrent" yaml:"isCurrent"`
	KubeconfigPath        string `json:"kubeconfigPath" yaml:"kubeconfigPath"`
	CreatedAt             string `json:"createdAt" yaml:"createdAt"`
	UpdatedAt             string `json:"updatedAt" yaml:"updatedAt"`
}

// KubernetesContextSwitchRequest 明確指定 Context 所屬的 kubeconfig，避免切換到同名的其他設定。
type KubernetesContextSwitchRequest struct {
	ContextName    string `json:"contextName" yaml:"contextName"`
	KubeconfigPath string `json:"kubeconfigPath" yaml:"kubeconfigPath"`
}

// KubernetesConnectRequest 指定要在 TermiX Kubernetes 工作區開啟的 kubeconfig Context。
type KubernetesConnectRequest struct {
	ClusterID      string `json:"clusterId" yaml:"clusterId"`
	DisplayName    string `json:"displayName" yaml:"displayName"`
	ContextName    string `json:"contextName" yaml:"contextName"`
	ClusterName    string `json:"clusterName" yaml:"clusterName"`
	Server         string `json:"server" yaml:"server"`
	KubeconfigPath string `json:"kubeconfigPath" yaml:"kubeconfigPath"`
	Namespace      string `json:"namespace" yaml:"namespace"`
}

// KubernetesSession 不包含 kubeconfig User 或其他認證內容。
type KubernetesSession struct {
	SessionID      string `json:"sessionId" yaml:"sessionId"`
	ClusterID      string `json:"clusterId" yaml:"clusterId"`
	DisplayName    string `json:"displayName" yaml:"displayName"`
	ContextName    string `json:"contextName" yaml:"contextName"`
	ClusterName    string `json:"clusterName" yaml:"clusterName"`
	Server         string `json:"server" yaml:"server"`
	KubeconfigPath string `json:"kubeconfigPath" yaml:"kubeconfigPath"`
	Namespace      string `json:"namespace" yaml:"namespace"`
	ConnectedAt    string `json:"connectedAt" yaml:"connectedAt"`
}

type KubernetesDashboardRequest struct {
	Namespace string `json:"namespace" yaml:"namespace"`
	// Scope 為 "core" 時只抓 Overview 所需的核心資源（快速首屏）；空或其他值＝抓全部資源。
	Scope string `json:"scope" yaml:"scope"`
}

type KubernetesResourceDetailRequest struct {
	Kind       string `json:"kind" yaml:"kind"`
	Name       string `json:"name" yaml:"name"`
	Namespace  string `json:"namespace" yaml:"namespace"`
	APIVersion string `json:"apiVersion" yaml:"apiVersion"`
}

type KubernetesPodLogsRequest struct {
	Namespace string `json:"namespace" yaml:"namespace"`
	PodName   string `json:"podName" yaml:"podName"`
	Container string `json:"container" yaml:"container"`
	Previous  bool   `json:"previous" yaml:"previous"`
	TailLines int64  `json:"tailLines" yaml:"tailLines"`
}

type KubernetesPodShellStartRequest struct {
	Namespace string `json:"namespace" yaml:"namespace"`
	PodName   string `json:"podName" yaml:"podName"`
	Container string `json:"container" yaml:"container"`
	Cols      uint16 `json:"cols" yaml:"cols"`
	Rows      uint16 `json:"rows" yaml:"rows"`
}

type KubernetesPodShellSessionRequest struct {
	SessionID string `json:"sessionId" yaml:"sessionId"`
	Data      string `json:"data" yaml:"data"`
	Cols      uint16 `json:"cols" yaml:"cols"`
	Rows      uint16 `json:"rows" yaml:"rows"`
}

type KubernetesPodShellSession struct {
	SessionID string `json:"sessionId"`
	Namespace string `json:"namespace"`
	PodName   string `json:"podName"`
	Container string `json:"container"`
}

type KubernetesPodDeleteRequest struct {
	Namespace string `json:"namespace" yaml:"namespace"`
	PodName   string `json:"podName" yaml:"podName"`
	UID       string `json:"uid" yaml:"uid"`
}

type KubernetesResourceDeleteRequest struct {
	Kind       string `json:"kind" yaml:"kind"`
	Name       string `json:"name" yaml:"name"`
	Namespace  string `json:"namespace" yaml:"namespace"`
	UID        string `json:"uid" yaml:"uid"`
	APIVersion string `json:"apiVersion" yaml:"apiVersion"`
}

type KubernetesPodPortForwardRequest struct {
	Namespace  string `json:"namespace" yaml:"namespace"`
	PodName    string `json:"podName" yaml:"podName"`
	LocalPort  int    `json:"localPort" yaml:"localPort"`
	RemotePort int    `json:"remotePort" yaml:"remotePort"`
}

type KubernetesPodPortForwardListRequest struct {
	Namespace string `json:"namespace" yaml:"namespace"`
	PodName   string `json:"podName" yaml:"podName"`
}

type KubernetesPodPortForwardStopRequest struct {
	ID string `json:"id" yaml:"id"`
}

type KubernetesServicePortForwardRequest struct {
	Namespace   string `json:"namespace" yaml:"namespace"`
	ServiceName string `json:"serviceName" yaml:"serviceName"`
	LocalPort   int    `json:"localPort" yaml:"localPort"`
	RemotePort  int    `json:"remotePort" yaml:"remotePort"`
}

type KubernetesServicePortForwardListRequest struct {
	Namespace   string `json:"namespace" yaml:"namespace"`
	ServiceName string `json:"serviceName" yaml:"serviceName"`
}

type KubernetesResourceCreateRequest struct {
	ResourceType string `json:"resourceType" yaml:"resourceType"`
	Namespace    string `json:"namespace" yaml:"namespace"`
	YAML         string `json:"yaml" yaml:"yaml"`
}

type KubernetesResourceCreateResult struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
}

// KubernetesResourceUpdateRequest 用於套用編輯後的整份 YAML。
// 更新的 GVK 與 name 由 YAML 內容解析（與 Create 一致），Namespace 僅作為 YAML 未指定時的 fallback。
type KubernetesResourceUpdateRequest struct {
	Namespace string `json:"namespace" yaml:"namespace"`
	YAML      string `json:"yaml" yaml:"yaml"`
}

type KubernetesKeyValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type KubernetesResourceCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason"`
	Message            string `json:"message"`
	LastTransitionTime string `json:"lastTransitionTime"`
}

type KubernetesContainerDetail struct {
	Name         string                    `json:"name"`
	Image        string                    `json:"image"`
	Ready        bool                      `json:"ready"`
	RestartCount int32                     `json:"restartCount"`
	State        string                    `json:"state"`
	Ports        []KubernetesContainerPort `json:"ports"`
}

type KubernetesContainerPort struct {
	Name     string `json:"name"`
	Port     int32  `json:"port"`
	Protocol string `json:"protocol"`
}

type KubernetesOwnerReference struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid"`
	Controller bool   `json:"controller"`
}

type KubernetesEventSummary struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Message   string `json:"message"`
	Object    string `json:"object"`
	Namespace string `json:"namespace"`
	Count     int32  `json:"count"`
	Timestamp string `json:"timestamp"`
}

type KubernetesResourceDetail struct {
	Kind        string                        `json:"kind"`
	Name        string                        `json:"name"`
	Namespace   string                        `json:"namespace"`
	Status      string                        `json:"status"`
	CreatedAt   string                        `json:"createdAt"`
	UID         string                        `json:"uid"`
	APIVersion  string                        `json:"apiVersion"`
	YAML        string                        `json:"yaml"`
	Labels      []KubernetesKeyValue          `json:"labels"`
	Owners      []KubernetesOwnerReference    `json:"owners"`
	Fields      []KubernetesKeyValue          `json:"fields"`
	Conditions  []KubernetesResourceCondition `json:"conditions"`
	Containers  []KubernetesContainerDetail   `json:"containers"`
	Events      []KubernetesEventSummary      `json:"events"`
	EventsError string                        `json:"eventsError"`
}

type KubernetesPodPortForward struct {
	ID          string `json:"id"`
	Namespace   string `json:"namespace"`
	PodName     string `json:"podName"`
	ServiceName string `json:"serviceName"`
	Address     string `json:"address"`
	LocalPort   int    `json:"localPort"`
	RemotePort  int    `json:"remotePort"`
	StartedAt   string `json:"startedAt"`
}

type KubernetesPodLogs struct {
	Container string `json:"container"`
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
}

type KubernetesNodeSummary struct {
	Name                string `json:"name"`
	Status              string `json:"status"`
	Roles               string `json:"roles"`
	Version             string `json:"version"`
	CPUCapacityMilli    int64  `json:"cpuCapacityMilli"`
	MemoryCapacityBytes int64  `json:"memoryCapacityBytes"`
	CPUUsageMilli       int64  `json:"cpuUsageMilli"`
	MemoryUsageBytes    int64  `json:"memoryUsageBytes"`
	CreationTimestamp   string `json:"creationTimestamp"`
}

type KubernetesPodSummary struct {
	Name              string                          `json:"name"`
	Namespace         string                          `json:"namespace"`
	UID               string                          `json:"uid"`
	Phase             string                          `json:"phase"`
	Status            string                          `json:"status"`
	Ready             string                          `json:"ready"`
	Restarts          int32                           `json:"restarts"`
	NodeName          string                          `json:"nodeName"`
	CPUUsageMilli     int64                           `json:"cpuUsageMilli"`
	MemoryUsageBytes  int64                           `json:"memoryUsageBytes"`
	CreationTimestamp string                          `json:"creationTimestamp"`
	Containers        []KubernetesPodContainerSummary `json:"containers"`
	Labels            map[string]string               `json:"labels"`
}

type KubernetesPodContainerSummary struct {
	Name  string                    `json:"name"`
	Ports []KubernetesContainerPort `json:"ports"`
}

type KubernetesWorkloadSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	DesiredReplicas   int32  `json:"desiredReplicas"`
	ReadyReplicas     int32  `json:"readyReplicas"`
	AvailableReplicas int32             `json:"availableReplicas"`
	Status            string            `json:"status"`
	CreationTimestamp string            `json:"creationTimestamp"`
	Selector          map[string]string `json:"selector"`
}

type KubernetesJobSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Completions       string `json:"completions"`
	Succeeded         int32  `json:"succeeded"`
	Status            string `json:"status"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesCronJobSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Schedule          string `json:"schedule"`
	Suspend           bool   `json:"suspend"`
	Active            int    `json:"active"`
	LastSchedule      string `json:"lastSchedule"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesServiceSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Type              string `json:"type"`
	ClusterIP         string `json:"clusterIp"`
	ExternalAddresses string `json:"externalAddresses"`
	Ports             string            `json:"ports"`
	PortNumbers       []int             `json:"portNumbers"`
	CreationTimestamp string            `json:"creationTimestamp"`
	Selector          map[string]string `json:"selector"`
}

type KubernetesIngressSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	IngressClass      string `json:"ingressClass"`
	Hosts             string `json:"hosts"`
	Addresses         string `json:"addresses"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesPersistentVolumeClaimSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Status            string `json:"status"`
	VolumeName        string `json:"volumeName"`
	Capacity          string `json:"capacity"`
	StorageClass      string `json:"storageClass"`
	AccessModes       string `json:"accessModes"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesPersistentVolumeSummary struct {
	Name              string `json:"name"`
	Status            string `json:"status"`
	Capacity          string `json:"capacity"`
	StorageClass      string `json:"storageClass"`
	AccessModes       string `json:"accessModes"`
	ReclaimPolicy     string `json:"reclaimPolicy"`
	Claim             string `json:"claim"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesStorageClassSummary struct {
	Name              string `json:"name"`
	Provisioner       string `json:"provisioner"`
	ReclaimPolicy     string `json:"reclaimPolicy"`
	VolumeBindingMode string `json:"volumeBindingMode"`
	AllowExpansion    bool   `json:"allowExpansion"`
	IsDefault         bool   `json:"isDefault"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesNamespaceSummary struct {
	Name              string `json:"name"`
	Status            string `json:"status"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesEndpointsSummary 承載 Endpoints 的中繼資料與位址總數（所有 subsets 的 addresses 加總）。
type KubernetesEndpointsSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Addresses         int    `json:"addresses"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesNetworkPolicySummary 承載 NetworkPolicy 的中繼資料與 PolicyTypes（如 "Ingress,Egress"）。
type KubernetesNetworkPolicySummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	PolicyTypes       string `json:"policyTypes"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesHorizontalPodAutoscalerSummary 承載 HPA 的中繼資料、目標與副本數範圍。
type KubernetesHorizontalPodAutoscalerSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Reference         string `json:"reference"`
	MinReplicas       int    `json:"minReplicas"`
	MaxReplicas       int    `json:"maxReplicas"`
	CurrentReplicas   int    `json:"currentReplicas"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesPodDisruptionBudgetSummary 承載 PDB 的中繼資料與可用副本狀態。
type KubernetesPodDisruptionBudgetSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	MinAvailable      string `json:"minAvailable"`
	MaxUnavailable    string `json:"maxUnavailable"`
	CurrentHealthy    int    `json:"currentHealthy"`
	DesiredHealthy    int    `json:"desiredHealthy"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesResourceQuotaSummary 承載 ResourceQuota 的中繼資料、硬限制數量與適用範圍。
type KubernetesResourceQuotaSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	HardLimits        int    `json:"hardLimits"`
	Scopes            string `json:"scopes"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesCustomResourceDefinitionSummary 承載 CRD 的中繼資料（cluster-scoped，無 Namespace）。
type KubernetesCustomResourceDefinitionSummary struct {
	Name              string `json:"name"`
	Group             string `json:"group"`
	Kind              string `json:"kind"`
	Scope             string `json:"scope"`
	Versions          string `json:"versions"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesServiceAccountSummary 僅承載 ServiceAccount 的中繼資料與關聯 secret「數量」，
// 絕不包含任何 secret 名稱或 token 內容。
type KubernetesServiceAccountSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Secrets           int    `json:"secrets"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesRoleSummary 承載 namespaced Role 的中繼資料與規則數量。
type KubernetesRoleSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Rules             int    `json:"rules"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesRoleBindingSummary 承載 namespaced RoleBinding 的中繼資料、RoleRef 與 subject 數量。
type KubernetesRoleBindingSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	RoleRef           string `json:"roleRef"`
	Subjects          int    `json:"subjects"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesClusterRoleSummary 承載 cluster-scoped ClusterRole 的中繼資料與規則數量（無 Namespace）。
type KubernetesClusterRoleSummary struct {
	Name              string `json:"name"`
	Rules             int    `json:"rules"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesClusterRoleBindingSummary 承載 cluster-scoped ClusterRoleBinding 的中繼資料、RoleRef 與 subject 數量（無 Namespace）。
type KubernetesClusterRoleBindingSummary struct {
	Name              string `json:"name"`
	RoleRef           string `json:"roleRef"`
	Subjects          int    `json:"subjects"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesConfigMapSummary 僅承載 ConfigMap 的中繼資料與 key 數量，不含任何 value。
type KubernetesConfigMapSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	DataKeys          int    `json:"dataKeys"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// KubernetesSecretSummary 僅承載 Secret 的中繼資料、型別與 key 數量，
// 嚴禁包含任何 Data/value 欄位，確保 Secret 的機密內容不會離開後端。
type KubernetesSecretSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Type              string `json:"type"`
	DataKeys          int    `json:"dataKeys"`
	CreationTimestamp string `json:"creationTimestamp"`
}

type KubernetesOverviewCounts struct {
	Nodes             int `json:"nodes"`
	ReadyNodes        int `json:"readyNodes"`
	Pods              int `json:"pods"`
	RunningPods       int `json:"runningPods"`
	PendingPods       int `json:"pendingPods"`
	FailedPods        int `json:"failedPods"`
	SucceededPods     int `json:"succeededPods"`
	Deployments       int `json:"deployments"`
	ReadyDeployments  int `json:"readyDeployments"`
	StatefulSets      int `json:"statefulSets"`
	ReadyStatefulSets int `json:"readyStatefulSets"`
	Services          int `json:"services"`
	WarningEvents     int `json:"warningEvents"`
}

type KubernetesMetricsSummary struct {
	Available           bool   `json:"available"`
	Error               string `json:"error"`
	CPUUsageMilli       int64  `json:"cpuUsageMilli"`
	CPUCapacityMilli    int64  `json:"cpuCapacityMilli"`
	MemoryUsageBytes    int64  `json:"memoryUsageBytes"`
	MemoryCapacityBytes int64  `json:"memoryCapacityBytes"`
}

type KubernetesDashboardSnapshot struct {
	SessionID                 string                                      `json:"sessionId"`
	ClusterName               string                                      `json:"clusterName"`
	ContextName               string                                      `json:"contextName"`
	Namespace                 string                                      `json:"namespace"`
	ServerVersion             string                                      `json:"serverVersion"`
	GeneratedAt               string                                      `json:"generatedAt"`
	// Partial＝此快照僅含核心資源（scope=core 的首屏結果），前端不應據此判定其餘 section 為空。
	Partial                   bool                                        `json:"partial"`
	Namespaces                []string                                    `json:"namespaces"`
	NamespaceDetails          []KubernetesNamespaceSummary                `json:"namespaceDetails"`
	Overview                  KubernetesOverviewCounts                    `json:"overview"`
	Metrics                   KubernetesMetricsSummary                    `json:"metrics"`
	Nodes                     []KubernetesNodeSummary                     `json:"nodes"`
	Pods                      []KubernetesPodSummary                      `json:"pods"`
	Deployments               []KubernetesWorkloadSummary                 `json:"deployments"`
	StatefulSets              []KubernetesWorkloadSummary                 `json:"statefulSets"`
	DaemonSets                []KubernetesWorkloadSummary                 `json:"daemonSets"`
	Jobs                      []KubernetesJobSummary                      `json:"jobs"`
	CronJobs                  []KubernetesCronJobSummary                  `json:"cronJobs"`
	Services                  []KubernetesServiceSummary                  `json:"services"`
	Ingresses                 []KubernetesIngressSummary                  `json:"ingresses"`
	PersistentVolumeClaims    []KubernetesPersistentVolumeClaimSummary    `json:"persistentVolumeClaims"`
	PersistentVolumes         []KubernetesPersistentVolumeSummary         `json:"persistentVolumes"`
	StorageClasses            []KubernetesStorageClassSummary             `json:"storageClasses"`
	ConfigMaps                []KubernetesConfigMapSummary                `json:"configMaps"`
	Secrets                   []KubernetesSecretSummary                   `json:"secrets"`
	Endpoints                 []KubernetesEndpointsSummary                `json:"endpoints"`
	NetworkPolicies           []KubernetesNetworkPolicySummary            `json:"networkPolicies"`
	ServiceAccounts           []KubernetesServiceAccountSummary           `json:"serviceAccounts"`
	Roles                     []KubernetesRoleSummary                     `json:"roles"`
	RoleBindings              []KubernetesRoleBindingSummary              `json:"roleBindings"`
	ClusterRoles              []KubernetesClusterRoleSummary              `json:"clusterRoles"`
	ClusterRoleBindings       []KubernetesClusterRoleBindingSummary       `json:"clusterRoleBindings"`
	HorizontalPodAutoscalers  []KubernetesHorizontalPodAutoscalerSummary  `json:"horizontalPodAutoscalers"`
	PodDisruptionBudgets      []KubernetesPodDisruptionBudgetSummary      `json:"podDisruptionBudgets"`
	ResourceQuotas            []KubernetesResourceQuotaSummary            `json:"resourceQuotas"`
	CustomResourceDefinitions []KubernetesCustomResourceDefinitionSummary `json:"customResourceDefinitions"`
	ResourceErrors            map[string]string                           `json:"resourceErrors"`
	Events                    []KubernetesEventSummary                    `json:"events"`
}

type HostVaultSnapshot struct {
	Hosts    []HostProfile `json:"hosts" yaml:"hosts"`
	Groups   []HostGroup   `json:"groups" yaml:"groups"`
	Settings AppSettings   `json:"settings" yaml:"settings"`
}

type HostConnectionRequest struct {
	HostID    string `json:"hostId" yaml:"hostId"`
	SessionID string `json:"sessionId" yaml:"sessionId"`
}

type HostImportOptions struct {
	Format string `json:"format" yaml:"format"`
	Mode   string `json:"mode" yaml:"mode"`
}

type HostExportOptions struct {
	Format string `json:"format" yaml:"format"`
	Mode   string `json:"mode" yaml:"mode"`
}

type ExportedSecretValue struct {
	Ref   string `json:"ref,omitempty" yaml:"ref,omitempty"`
	Value string `json:"value,omitempty" yaml:"value,omitempty"`
}

type HostExportSecret struct {
	SSHPasswordRef   string               `json:"sshPasswordRef,omitempty" yaml:"sshPasswordRef,omitempty"`
	KeyPassphraseRef string               `json:"keyPassphraseRef,omitempty" yaml:"keyPassphraseRef,omitempty"`
	SudoPasswordRef  string               `json:"sudoPasswordRef,omitempty" yaml:"sudoPasswordRef,omitempty"`
	SSHPassword      *ExportedSecretValue `json:"sshPassword,omitempty" yaml:"sshPassword,omitempty"`
	KeyPassphrase    *ExportedSecretValue `json:"keyPassphrase,omitempty" yaml:"keyPassphrase,omitempty"`
	SudoPassword     *ExportedSecretValue `json:"sudoPassword,omitempty" yaml:"sudoPassword,omitempty"`
}

type HostExportConfig struct {
	Host                       string                `json:"host" yaml:"host"`
	Port                       int                   `json:"port" yaml:"port"`
	Username                   string                `json:"username" yaml:"username"`
	AuthMode                   string                `json:"authMode" yaml:"authMode"`
	PrivateKeyPath             string                `json:"privateKeyPath" yaml:"privateKeyPath"`
	KeychainKeyID              string                `json:"keychainKeyId,omitempty" yaml:"keychainKeyId,omitempty"`
	CertPath                   string                `json:"certPath" yaml:"certPath"`
	Secret                     *HostExportSecret     `json:"secret,omitempty" yaml:"secret,omitempty"`
	ShowSnippetsInControlPanel bool                  `json:"showSnippetsInControlPanel,omitempty" yaml:"showSnippetsInControlPanel,omitempty"`
	StartupSnippetIDs          []string              `json:"startupSnippetIds,omitempty" yaml:"startupSnippetIds,omitempty"`
	StartupCommandMode         string                `json:"startupCommandMode,omitempty" yaml:"startupCommandMode,omitempty"`
	StartupCommandText         string                `json:"startupCommandText,omitempty" yaml:"startupCommandText,omitempty"`
	CustomComponents           []HostCustomComponent `json:"customComponents,omitempty" yaml:"customComponents,omitempty"`
	EnableCustomQuery          bool                  `json:"enableCustomQuery,omitempty" yaml:"enableCustomQuery,omitempty"`
	CustomQueryScript          string                `json:"customQueryScript,omitempty" yaml:"customQueryScript,omitempty"`
}

type HostExportProfile struct {
	ID        string           `json:"id,omitempty" yaml:"id,omitempty"`
	Label     string           `json:"label,omitempty" yaml:"label,omitempty"`
	Alias     string           `json:"alias,omitempty" yaml:"alias,omitempty"`
	GroupID   string           `json:"groupId,omitempty" yaml:"groupId,omitempty"`
	Config    HostExportConfig `json:"config" yaml:"config"`
	CreatedAt string           `json:"createdAt,omitempty" yaml:"createdAt,omitempty"`
	UpdatedAt string           `json:"updatedAt,omitempty" yaml:"updatedAt,omitempty"`
}

type HostVaultExport struct {
	Version    string              `json:"version" yaml:"version"`
	ExportedAt string              `json:"exportedAt" yaml:"exportedAt"`
	Hosts      []HostExportProfile `json:"hosts" yaml:"hosts"`
	Groups     []HostGroup         `json:"groups,omitempty" yaml:"groups,omitempty"`
	Settings   AppSettings         `json:"settings,omitempty" yaml:"settings,omitempty"`
}

type HostImportResult struct {
	HostsImported    int      `json:"hostsImported" yaml:"hostsImported"`
	GroupsImported   int      `json:"groupsImported" yaml:"groupsImported"`
	SettingsImported int      `json:"settingsImported" yaml:"settingsImported"`
	SecretsWritten   int      `json:"secretsWritten" yaml:"secretsWritten"`
	Warnings         []string `json:"warnings" yaml:"warnings"`
}

type TerminalCommandRequest struct {
	SSH     SSHConfig `json:"ssh"`
	Command string    `json:"command"`
}

type OperationResult struct {
	Success    bool   `json:"success"`
	Output     string `json:"output"`
	Error      string `json:"error"`
	SessionKey string `json:"sessionKey"`
	IsSudo     bool   `json:"isSudo"`
}

type AutocompleteResult struct {
	Success     bool     `json:"success"`
	Suggestions []string `json:"suggestions"`
	LastWord    string   `json:"lastWord"`
	IsPath      bool     `json:"isPath"`
}

type Snippet struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Script      string `json:"script"`
	Package     string `json:"package"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type SnippetUpsertRequest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Script      string `json:"script"`
	Package     string `json:"package"`
}

type HostStartupSnippet struct {
	HostKey          string `json:"hostKey"`
	StartupSnippetID string `json:"startupSnippetId"`
}

type HostStartupSnippetRequest struct {
	SSH              SSHConfig `json:"ssh"`
	StartupSnippetID string    `json:"startupSnippetId"`
}

type SnippetExecutionTarget struct {
	SSH SSHConfig `json:"ssh"`
}

type ExecuteSnippetBatchRequest struct {
	SnippetID string                   `json:"snippetId"`
	Targets   []SnippetExecutionTarget `json:"targets"`
}

type SnippetExecutionItemResult struct {
	HostKey string `json:"hostKey"`
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error"`
}

type SnippetBatchResult struct {
	Success bool                         `json:"success"`
	Results []SnippetExecutionItemResult `json:"results"`
}
