package kubernetes

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jie0214/TermiX/backend/common"
	"github.com/jie0214/TermiX/shared/dto"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/tools/portforward"
	transportspdy "k8s.io/client-go/transport/spdy"
)

const podPortForwardAddress = "127.0.0.1"

// logger 使用專案統一的結構化日誌記錄器（DomainLogger），與其他 k8s/hostvault/storage
// 模組保持一致，取代先前混用的標準庫 log。
var logger = common.DomainLogger("kubernetes")

type podPortForwardRuntime struct {
	localPort int
	stop      func()
	done      <-chan error
}

type podPortForwardStarter func(*clusterClients, string, string, int, int) (*podPortForwardRuntime, error)

type podPortForwardEntry struct {
	summary dto.KubernetesPodPortForward
	stop    func()
}

func (s *Service) DeletePod(ctx context.Context, request dto.KubernetesPodDeleteRequest) error {
	clients, session, err := s.activeConnection()
	if err != nil {
		return err
	}
	namespace := effectiveNamespace(request.Namespace, session.Namespace)
	podName := strings.TrimSpace(request.PodName)
	logger.Infof("[Kubernetes][DeletePod] request namespace=%q pod=%q uid=%q", namespace, podName, strings.TrimSpace(request.UID))
	if namespace == metav1.NamespaceAll || podName == "" {
		return errors.New("刪除 Pod 時必須指定 Namespace 與 Pod 名稱")
	}
	options := metav1.DeleteOptions{}
	if uid := strings.TrimSpace(request.UID); uid != "" {
		value := types.UID(uid)
		options.Preconditions = &metav1.Preconditions{UID: &value}
	}
	if err := clients.core.CoreV1().Pods(namespace).Delete(ctx, podName, options); err != nil {
		logger.Errorf("[Kubernetes][DeletePod] failed namespace=%q pod=%q err=%v", namespace, podName, err)
		return podActionError("刪除 Pod", err)
	}
	logger.Infof("[Kubernetes][DeletePod] success namespace=%q pod=%q", namespace, podName)
	s.stopPodPortForwardsForPod(namespace, podName)
	return nil
}

func (s *Service) DeleteResource(ctx context.Context, request dto.KubernetesResourceDeleteRequest) error {
	clients, session, err := s.activeConnection()
	if err != nil {
		return err
	}
	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	name := strings.TrimSpace(request.Name)
	logger.Infof("[Kubernetes][DeleteResource] request kind=%q namespace=%q name=%q uid=%q", kind, strings.TrimSpace(request.Namespace), name, strings.TrimSpace(request.UID))
	if name == "" {
		return errors.New("刪除 Kubernetes 資源時必須指定名稱")
	}
	if kind == "pod" {
		return s.DeletePod(ctx, dto.KubernetesPodDeleteRequest{
			Namespace: request.Namespace,
			PodName:   name,
			UID:       request.UID,
		})
	}
	// 其他 kind 走泛用路徑：GVK → RESTMapping 取得 scope → dynamic Delete。
	gvk, err := requestGVK(request.APIVersion, request.Kind)
	if err != nil {
		return err
	}
	if clients.dynamic == nil || clients.restMapper == nil {
		return errors.New("目前連線不支援動態刪除資源")
	}
	mapping, err := resolveRESTMapping(clients.restMapper, gvk)
	if err != nil {
		return deleteResourceError(err)
	}
	clusterScoped := mapping.Scope.Name() != meta.RESTScopeNameNamespace
	namespace := ""
	if !clusterScoped {
		namespace = effectiveNamespace(request.Namespace, session.Namespace)
		if namespace == metav1.NamespaceAll {
			return errors.New("刪除 Kubernetes 資源時必須指定 Namespace")
		}
	}
	options := metav1.DeleteOptions{}
	if uid := strings.TrimSpace(request.UID); uid != "" {
		value := types.UID(uid)
		options.Preconditions = &metav1.Preconditions{UID: &value}
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resource := clients.dynamic.Resource(mapping.Resource)
	if clusterScoped {
		err = resource.Delete(ctx, name, options)
	} else {
		err = resource.Namespace(namespace).Delete(ctx, name, options)
	}
	if err != nil {
		logger.Errorf("[Kubernetes][DeleteResource] failed kind=%q namespace=%q name=%q err=%v", kind, namespace, name, err)
		return deleteResourceError(err)
	}
	logger.Infof("[Kubernetes][DeleteResource] success kind=%q namespace=%q name=%q", kind, namespace, name)
	return nil
}

// deleteResourceError 在 podActionError 之上補一個 meta.IsNoMatchError 分支（找不到資源類型）。
func deleteResourceError(err error) error {
	if meta.IsNoMatchError(err) {
		return errors.New("刪除 Kubernetes Resource 失敗：叢集中找不到此資源類型")
	}
	return podActionError("刪除 Kubernetes Resource", err)
}

func (s *Service) StartPodPortForward(ctx context.Context, request dto.KubernetesPodPortForwardRequest) (dto.KubernetesPodPortForward, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesPodPortForward{}, err
	}
	namespace := effectiveNamespace(request.Namespace, session.Namespace)
	podName := strings.TrimSpace(request.PodName)
	if namespace == metav1.NamespaceAll || podName == "" {
		return dto.KubernetesPodPortForward{}, errors.New("Port Forward 必須指定 Namespace 與 Pod 名稱")
	}
	if request.LocalPort < 0 || request.LocalPort > 65535 || request.RemotePort < 1 || request.RemotePort > 65535 {
		return dto.KubernetesPodPortForward{}, errors.New("Port Forward 連接埠必須介於 1 至 65535，本機連接埠可使用 0 自動分配")
	}
	checkCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if _, err := clients.core.CoreV1().Pods(namespace).Get(checkCtx, podName, metav1.GetOptions{}); err != nil {
		return dto.KubernetesPodPortForward{}, podActionError("建立 Port Forward", err)
	}
	starter := s.forwardStarter
	if starter == nil {
		starter = startPodPortForward
	}
	runtime, err := starter(clients, namespace, podName, request.LocalPort, request.RemotePort)
	if err != nil {
		return dto.KubernetesPodPortForward{}, errors.New("建立 Port Forward 失敗：請檢查 pods/portforward 權限、API Server 與本機連接埠")
	}
	summary := dto.KubernetesPodPortForward{
		ID: uuid.NewString(), Namespace: namespace, PodName: podName,
		Address: podPortForwardAddress, LocalPort: runtime.localPort, RemotePort: request.RemotePort,
	}
	s.mu.Lock()
	if s.activeClients != clients {
		s.mu.Unlock()
		runtime.stop()
		return dto.KubernetesPodPortForward{}, errors.New("Kubernetes Cluster 已切換，Port Forward 已取消")
	}
	if s.portForwards == nil {
		s.portForwards = make(map[string]*podPortForwardEntry)
	}
	s.portForwards[summary.ID] = &podPortForwardEntry{summary: summary, stop: runtime.stop}
	s.mu.Unlock()
	go func(id string, done <-chan error) {
		<-done
		s.mu.Lock()
		delete(s.portForwards, id)
		s.mu.Unlock()
	}(summary.ID, runtime.done)
	return summary, nil
}

func (s *Service) ListPodPortForwards(request dto.KubernetesPodPortForwardListRequest) []dto.KubernetesPodPortForward {
	s.mu.Lock()
	defer s.mu.Unlock()
	namespace := strings.TrimSpace(request.Namespace)
	podName := strings.TrimSpace(request.PodName)
	result := make([]dto.KubernetesPodPortForward, 0)
	for _, entry := range s.portForwards {
		if namespace != "" && entry.summary.Namespace != namespace {
			continue
		}
		if podName != "" && entry.summary.PodName != podName {
			continue
		}
		result = append(result, entry.summary)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].LocalPort < result[j].LocalPort })
	return result
}

func (s *Service) StopPodPortForward(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("Port Forward ID 不可為空")
	}
	s.mu.Lock()
	entry, found := s.portForwards[id]
	if found {
		delete(s.portForwards, id)
	}
	s.mu.Unlock()
	if !found {
		return errors.New("找不到指定的 Port Forward")
	}
	entry.stop()
	return nil
}

func (s *Service) stopPodPortForwardsForPod(namespace, podName string) {
	s.mu.Lock()
	entries := make([]*podPortForwardEntry, 0)
	for id, entry := range s.portForwards {
		if entry.summary.Namespace == namespace && entry.summary.PodName == podName {
			entries = append(entries, entry)
			delete(s.portForwards, id)
		}
	}
	s.mu.Unlock()
	for _, entry := range entries {
		entry.stop()
	}
}

func (s *Service) stopAllPodPortForwardsLocked() {
	for id, entry := range s.portForwards {
		entry.stop()
		delete(s.portForwards, id)
	}
}

func startPodPortForward(clients *clusterClients, namespace, podName string, localPort, remotePort int) (*podPortForwardRuntime, error) {
	if clients == nil || clients.restConfig == nil || clients.core == nil || clients.core.CoreV1().RESTClient() == nil {
		return nil, errors.New("Kubernetes Port Forward Client 無法使用")
	}
	requestURL := clients.core.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(namespace).Name(podName).SubResource("portforward").URL()
	roundTripper, upgrader, err := transportspdy.RoundTripperFor(clients.restConfig)
	if err != nil {
		return nil, err
	}
	spdyDialer := transportspdy.NewDialer(upgrader, &http.Client{Transport: roundTripper}, http.MethodPost, requestURL)
	dialer := httpstream.Dialer(spdyDialer)
	if websocketDialer, websocketErr := portforward.NewSPDYOverWebsocketDialer(requestURL, clients.restConfig); websocketErr == nil {
		dialer = portforward.NewFallbackDialer(websocketDialer, spdyDialer, func(err error) bool {
			return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
		})
	}
	stopChan := make(chan struct{})
	readyChan := make(chan struct{})
	done := make(chan error, 1)
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { close(stopChan) }) }
	var out bytes.Buffer
	forwarder, err := portforward.NewOnAddresses(
		dialer, []string{podPortForwardAddress},
		[]string{fmt.Sprintf("%d:%d", localPort, remotePort)}, stopChan, readyChan, &out, &out,
	)
	if err != nil {
		return nil, err
	}
	go func() { done <- forwarder.ForwardPorts() }()
	select {
	case <-readyChan:
		ports, err := forwarder.GetPorts()
		if err != nil || len(ports) != 1 {
			stop()
			return nil, errors.New("Port Forward 未回傳本機連接埠")
		}
		return &podPortForwardRuntime{localPort: int(ports[0].Local), stop: stop, done: done}, nil
	case err := <-done:
		stop()
		return nil, err
	case <-time.After(15 * time.Second):
		stop()
		return nil, errors.New("Port Forward 啟動逾時")
	}
}

func podActionError(action string, err error) error {
	switch {
	case apierrors.IsForbidden(err):
		return fmt.Errorf("%s 失敗：目前 kubeconfig 身分沒有存取權限", action)
	case apierrors.IsUnauthorized(err):
		return fmt.Errorf("%s 失敗：Kubernetes 認證已失效", action)
	case apierrors.IsNotFound(err):
		return fmt.Errorf("%s 失敗：找不到指定資源", action)
	case apierrors.IsConflict(err):
		return fmt.Errorf("%s 失敗：資源已被修改或取代，請重新整理", action)
	default:
		return fmt.Errorf("%s 失敗：請檢查網路、API Server 與 kubeconfig 認證設定", action)
	}
}
