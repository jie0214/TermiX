package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jie0214/TermiX/backend/storage"
	"github.com/jie0214/TermiX/shared/dto"
)

type Service struct {
	repo           *storage.Repository
	mu             sync.Mutex
	activeSession  *dto.KubernetesSession
	activeClients  *clusterClients
	clientFactory  clusterClientFactory
	portForwards   map[string]*podPortForwardEntry
	forwardStarter podPortForwardStarter
	podShells      map[string]*podShellEntry
}

func NewService(repo *storage.Repository) *Service {
	return &Service{
		repo: repo, clientFactory: buildClusterClients,
		portForwards:   make(map[string]*podPortForwardEntry),
		forwardStarter: startPodPortForward,
		podShells:      make(map[string]*podShellEntry),
	}
}

func defaultKubeconfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("無法取得使用者目錄：%w", err)
	}
	return filepath.Join(home, ".kube", "config"), nil
}

func normalizePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return defaultKubeconfigPath()
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("無法展開 kubeconfig 路徑：%w", err)
		}
		path = filepath.Join(home, strings.TrimPrefix(path, "~/"))
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("無法正規化 kubeconfig 路徑：%w", err)
	}
	return filepath.Clean(abs), nil
}

func (s *Service) List(ctx context.Context) ([]dto.KubernetesClusterProfile, error) {
	path, err := defaultKubeconfigPath()
	if err != nil {
		return nil, err
	}
	managed, err := s.repo.ListKubernetesClusters(ctx)
	if err != nil {
		return nil, err
	}
	paths := map[string]bool{path: true}
	for _, item := range managed {
		paths[item.KubeconfigPath] = true
	}
	byKey := make(map[string]dto.KubernetesClusterProfile)
	for configPath := range paths {
		discovered, readErr := readProfiles(configPath)
		if readErr != nil {
			if errors.Is(readErr, os.ErrNotExist) {
				continue
			}
			return nil, readErr
		}
		for _, item := range discovered {
			byKey[item.KubeconfigPath+"\x00"+item.ContextName] = item
		}
	}
	for _, metadata := range managed {
		key := metadata.KubeconfigPath + "\x00" + metadata.ContextName
		item, exists := byKey[key]
		if !exists {
			item = metadata
		}
		item.ID, item.DisplayName, item.Source = metadata.ID, metadata.DisplayName, "managed"
		item.CreatedAt, item.UpdatedAt = metadata.CreatedAt, metadata.UpdatedAt
		byKey[key] = item
	}
	result := make([]dto.KubernetesClusterProfile, 0, len(byKey))
	for _, item := range byKey {
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsCurrent != result[j].IsCurrent {
			return result[i].IsCurrent
		}
		return result[i].DisplayName < result[j].DisplayName
	})
	return result, nil
}

func (s *Service) Save(ctx context.Context, item dto.KubernetesClusterProfile) (dto.KubernetesClusterProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item.ContextName, item.ClusterName = strings.TrimSpace(item.ContextName), strings.TrimSpace(item.ClusterName)
	item.Server, item.UserName = strings.TrimSpace(item.Server), strings.TrimSpace(item.UserName)
	if item.ContextName == "" || item.ClusterName == "" || item.Server == "" || item.UserName == "" {
		return item, errors.New("Context、Cluster、API Server 與 User 均為必填")
	}
	if item.InsecureSkipTLSVerify && strings.TrimSpace(item.CertificateAuthority) != "" {
		return item, errors.New("Certificate Authority 與略過 TLS 驗證不可同時設定")
	}
	parsed, err := url.ParseRequestURI(item.Server)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return item, errors.New("API Server 必須是有效的 HTTP 或 HTTPS URL")
	}
	item.KubeconfigPath, err = normalizePath(item.KubeconfigPath)
	if err != nil {
		return item, err
	}
	root, mode, err := loadConfig(item.KubeconfigPath, true)
	if err != nil {
		return item, err
	}
	if !namedEntryExists(mappingValue(root, "users"), item.UserName) {
		return item, fmt.Errorf("kubeconfig User「%s」不存在", item.UserName)
	}
	upsertCluster(root, item)
	upsertContext(root, item)
	if err := writeConfigAtomic(item.KubeconfigPath, root, mode); err != nil {
		return item, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if strings.TrimSpace(item.ID) == "" {
		item.ID, item.CreatedAt = uuid.NewString(), now
	}
	if item.CreatedAt == "" {
		item.CreatedAt = now
	}
	if item.DisplayName == "" {
		item.DisplayName = item.ContextName
	}
	item.UpdatedAt, item.Source = now, "managed"
	if err := s.repo.SaveKubernetesCluster(ctx, item); err != nil {
		return item, err
	}
	return item, nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("Kubernetes 叢集 ID 不可為空")
	}
	return s.repo.DeleteKubernetesCluster(ctx, id)
}

func (s *Service) SwitchContext(path, contextName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var err error
	path, err = normalizePath(path)
	if err != nil {
		return err
	}
	contextName = strings.TrimSpace(contextName)
	root, mode, err := loadConfig(path, false)
	if err != nil {
		return err
	}
	if !namedEntryExists(mappingValue(root, "contexts"), contextName) {
		return fmt.Errorf("Context「%s」不存在", contextName)
	}
	setMappingScalar(root, "current-context", contextName)
	return writeConfigAtomic(path, root, mode)
}

// Connect 建立或取代唯一的 Kubernetes 工作區 Session，並在 app 內連線成功後
// 以 best-effort 方式把 kubeconfig 的 current-context 切到該 context，
// 讓外部 kubectl/kubectx 與「目前使用中」徽章保持一致；kubeconfig 唯讀等
// 寫入失敗情況只記 Warn，不會讓連線失敗（app 內連線已成功）。
func (s *Service) Connect(request dto.KubernetesConnectRequest) (dto.KubernetesSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, err := normalizePath(request.KubeconfigPath)
	if err != nil {
		return dto.KubernetesSession{}, err
	}
	contextName := strings.TrimSpace(request.ContextName)
	if contextName == "" {
		return dto.KubernetesSession{}, errors.New("Kubernetes Context 名稱不可為空")
	}
	root, mode, err := loadConfig(path, false)
	if err != nil {
		return dto.KubernetesSession{}, err
	}
	contextNode := namedEntries(mappingValue(root, "contexts"))[contextName]
	if contextNode == nil {
		return dto.KubernetesSession{}, fmt.Errorf("Context「%s」不存在", contextName)
	}
	clusterName := strings.TrimSpace(scalarValue(mappingValue(contextNode, "cluster")))
	clusterNode := namedEntries(mappingValue(root, "clusters"))[clusterName]
	if clusterName == "" || clusterNode == nil {
		return dto.KubernetesSession{}, fmt.Errorf("Context「%s」引用的 Cluster「%s」不存在", contextName, clusterName)
	}
	displayName := strings.TrimSpace(request.DisplayName)
	if displayName == "" {
		displayName = contextName
	}
	session := dto.KubernetesSession{
		SessionID:      "kubernetes-tab",
		ClusterID:      strings.TrimSpace(request.ClusterID),
		DisplayName:    displayName,
		ContextName:    contextName,
		ClusterName:    clusterName,
		Server:         strings.TrimSpace(scalarValue(mappingValue(clusterNode, "server"))),
		KubeconfigPath: path,
		Namespace:      strings.TrimSpace(scalarValue(mappingValue(contextNode, "namespace"))),
		ConnectedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	clients, err := s.clientFactory(session)
	if err != nil {
		return dto.KubernetesSession{}, err
	}
	s.stopAllPodPortForwardsLocked()
	s.stopAllPodShellsLocked()
	s.activeSession = &session
	s.activeClients = clients

	// App 內連線已成功；best-effort 把 kubeconfig current-context 同步切到該 context，
	// 讓外部 kubectl/kubectx -c 與 listClusters 的 IsCurrent 徽章一致。已在上方
	// 驗證 context 存在，且已持有 s.mu，故直接 inline 寫入（不呼叫會再上鎖的
	// SwitchContext，以免死鎖）。寫入失敗（例如 kubeconfig 唯讀）只記 Warn，
	// 不影響已建立的連線 Session。
	setMappingScalar(root, "current-context", contextName)
	if err := writeConfigAtomic(path, root, mode); err != nil {
		logger.Warnf("[Kubernetes][Connect] 同步 kubeconfig current-context 失敗 path=%q context=%q err=%v", path, contextName, err)
	}
	return session, nil
}

// Disconnect 關閉唯一的 Kubernetes 工作區 Session。
func (s *Service) Disconnect() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopAllPodPortForwardsLocked()
	s.stopAllPodShellsLocked()
	s.activeSession = nil
	s.activeClients = nil
}

// GetActiveSession 回傳 Session 副本；沒有活動 Session 時回傳 nil。
func (s *Service) GetActiveSession() *dto.KubernetesSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeSession == nil {
		return nil
	}
	session := *s.activeSession
	return &session
}

func readProfiles(path string) ([]dto.KubernetesClusterProfile, error) {
	root, _, err := loadConfig(path, false)
	if err != nil {
		return nil, err
	}
	current := scalarValue(mappingValue(root, "current-context"))
	clusters := namedEntries(mappingValue(root, "clusters"))
	result := make([]dto.KubernetesClusterProfile, 0)
	for name, ctxNode := range namedEntries(mappingValue(root, "contexts")) {
		clusterName := scalarValue(mappingValue(ctxNode, "cluster"))
		cluster := clusters[clusterName]
		result = append(result, dto.KubernetesClusterProfile{
			DisplayName: name, ContextName: name, ClusterName: clusterName,
			Server: scalarValue(mappingValue(cluster, "server")), UserName: scalarValue(mappingValue(ctxNode, "user")),
			Namespace: scalarValue(mappingValue(ctxNode, "namespace")), CertificateAuthority: scalarValue(mappingValue(cluster, "certificate-authority")),
			InsecureSkipTLSVerify: scalarValue(mappingValue(cluster, "insecure-skip-tls-verify")) == "true",
			Source:                "discovered", IsCurrent: name == current, KubeconfigPath: path,
		})
	}
	return result, nil
}
