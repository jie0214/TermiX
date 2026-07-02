package kubernetes

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

type clusterClients struct {
	core          kubernetes.Interface
	metrics       metricsclient.Interface
	dynamic       dynamic.Interface
	restMapper    meta.RESTMapper
	serverVersion string
	podLogs       func(context.Context, string, string, *corev1.PodLogOptions) (io.ReadCloser, error)
	restConfig    *rest.Config
}

type clusterClientFactory func(dto.KubernetesSession) (*clusterClients, error)

func buildClusterClients(session dto.KubernetesSession) (*clusterClients, error) {
	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: session.KubeconfigPath}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: session.ContextName}
	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides)
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("建立 Kubernetes Client 設定失敗：請檢查 kubeconfig、Context 與認證設定")
	}
	restConfig.Timeout = 15 * time.Second
	restConfig.QPS = 20
	restConfig.Burst = 30
	restConfig.UserAgent = "TermiX Kubernetes Dashboard"

	coreClient, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("建立 Kubernetes API Client 失敗：請檢查 kubeconfig 連線設定")
	}
	metricsClient, err := metricsclient.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("建立 Kubernetes Metrics Client 失敗：請檢查 kubeconfig 連線設定")
	}
	// Dynamic Client 用於讀取 CRD 等未內建於 typed client 的資源（免加 apiextensions 依賴）。
	dynamicClient, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("建立 Kubernetes Dynamic Client 失敗：請檢查 kubeconfig 連線設定")
	}
	// RESTMapper 用於把 YAML 的 apiVersion/kind（GVK）對映到 GVR 與 scope，
	// 讓建立資源走泛用 dynamic client、不需逐 kind 寫死。以 memcache 包住 discovery
	// 降低往返；mapping miss（例如剛裝的 CRD）時由呼叫端 Reset() 後重試。
	cachedDiscovery := memory.NewMemCacheClient(coreClient.Discovery())
	restMapper := restmapper.NewDeferredDiscoveryRESTMapper(cachedDiscovery)
	version, err := coreClient.Discovery().ServerVersion()
	if err != nil {
		return nil, connectionError(err)
	}
	return &clusterClients{
		core:          coreClient,
		metrics:       metricsClient,
		dynamic:       dynamicClient,
		restMapper:    restMapper,
		serverVersion: version.GitVersion,
		restConfig:    rest.CopyConfig(restConfig),
		podLogs: func(ctx context.Context, namespace, name string, options *corev1.PodLogOptions) (io.ReadCloser, error) {
			return coreClient.CoreV1().Pods(namespace).GetLogs(name, options).Stream(ctx)
		},
	}, nil
}

func connectionError(err error) error {
	switch {
	case apierrors.IsForbidden(err):
		return fmt.Errorf("連接 Kubernetes API Server 失敗：目前 kubeconfig 身分沒有存取權限")
	case apierrors.IsUnauthorized(err):
		return fmt.Errorf("連接 Kubernetes API Server 失敗：Kubernetes 認證已失效")
	default:
		// 底層錯誤可能包含 Exec Credential Plugin 輸出，不直接回傳至前端。
		return fmt.Errorf("連接 Kubernetes API Server 失敗：請檢查網路、API Server 與 kubeconfig 認證設定")
	}
}
