package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
)

// LiveChange 僅傳送既有摘要投影，絕不將 Secret 的原始物件送到前端。
type LiveChange struct {
	Section string                   `json:"section"`
	Type    string                   `json:"type"`
	Items   []map[string]interface{} `json:"items,omitempty"`
	Item    map[string]interface{}   `json:"item,omitempty"`
	Error   string                   `json:"error,omitempty"`
}

type LiveBatch struct {
	ConnectedAt string       `json:"connectedAt"`
	StreamID    string       `json:"streamId"`
	Changes     []LiveChange `json:"changes"`
}

var errLiveClosed = errors.New("監看連線中斷")

type liveResource struct {
	section string
	gvr     schema.GroupVersionResource
	project func(unstructured.Unstructured) (map[string]interface{}, error)
}

func projectLive[T, R any](summary func(T) R) func(unstructured.Unstructured) (map[string]interface{}, error) {
	return func(obj unstructured.Unstructured) (map[string]interface{}, error) {
		var typed T
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(obj.Object, &typed); err != nil {
			return nil, err
		}
		return liveSummary(obj, summary(typed))
	}
}

func liveSummary(obj unstructured.Unstructured, summary interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(summary)
	if err != nil {
		return nil, err
	}
	var item map[string]interface{}
	if err = json.Unmarshal(data, &item); err != nil {
		return nil, err
	}
	item["uid"] = string(obj.GetUID())
	item["resourceVersion"] = obj.GetResourceVersion()
	item["name"] = obj.GetName()
	item["namespace"] = obj.GetNamespace()
	return item, nil
}

var liveResources = []liveResource{
	{"namespaceDetails", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "namespaces"}, projectLive(namespaceSummary)},
	{"nodes", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}, projectLive(nodeSummary)},
	{"pods", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}, projectLive(podSummary)},
	{"deployments", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, projectLive(deploymentSummary)},
	{"statefulSets", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}, projectLive(statefulSetSummary)},
	{"daemonSets", schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}, projectLive(daemonSetSummary)},
	{"services", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"}, projectLive(serviceSummary)},
	{"events", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "events"}, projectLive(eventSummary)},
	{"jobs", schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "jobs"}, projectLive(jobSummary)},
	{"cronJobs", schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "cronjobs"}, projectLive(cronJobSummary)},
	{"ingresses", schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}, projectLive(ingressSummary)},
	{"persistentVolumeClaims", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumeclaims"}, projectLive(persistentVolumeClaimSummary)},
	{"persistentVolumes", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumes"}, projectLive(persistentVolumeSummary)},
	{"storageClasses", schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"}, projectLive(storageClassSummary)},
	{"configMaps", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}, projectLive(configMapSummary)},
	{"secrets", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}, projectLive(secretSummary)},
	{"endpoints", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "endpoints"}, projectLive(endpointsSummary)},
	{"networkPolicies", schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"}, projectLive(networkPolicySummary)},
	{"serviceAccounts", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "serviceaccounts"}, projectLive(serviceAccountSummary)},
	{"roles", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}, projectLive(roleSummary)},
	{"roleBindings", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"}, projectLive(roleBindingSummary)},
	{"clusterRoles", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}, projectLive(clusterRoleSummary)},
	{"clusterRoleBindings", schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"}, projectLive(clusterRoleBindingSummary)},
	{"horizontalPodAutoscalers", schema.GroupVersionResource{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"}, projectLive(horizontalPodAutoscalerSummary)},
	{"podDisruptionBudgets", schema.GroupVersionResource{Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"}, projectLive(podDisruptionBudgetSummary)},
	{"resourceQuotas", schema.GroupVersionResource{Group: "", Version: "v1", Resource: "resourcequotas"}, projectLive(resourceQuotaSummary)},
	{"customResourceDefinitions", schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}, func(obj unstructured.Unstructured) (map[string]interface{}, error) {
		return liveSummary(obj, customResourceDefinitionSummary(obj))
	}},
}

// StartLiveUpdates 的 connectedAt 與 streamID 同時隔離叢集切換與同一叢集的重新訂閱。
func (s *Service) StartLiveUpdates(parent context.Context, connectedAt, streamID string, emit func(LiveBatch)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeSession == nil || s.activeClients == nil || s.activeSession.ConnectedAt != connectedAt {
		return errors.New("Kubernetes 連線已變更，請重新訂閱")
	}
	if streamID == "" {
		return errors.New("缺少 Kubernetes 訂閱識別碼")
	}
	client := s.activeClients.watchDynamic
	if client == nil {
		client = s.activeClients.dynamic
	}
	if client == nil {
		return errors.New("Kubernetes 即時更新無法使用")
	}
	s.stopLiveUpdatesLocked()
	ctx, cancel := context.WithCancel(parent)
	s.liveCancel, s.liveStreamID = cancel, streamID
	clients := s.activeClients
	changes := make(chan LiveChange, 256)
	send := func(change LiveChange) {
		select {
		case changes <- change:
		case <-ctx.Done():
		}
	}
	for _, resource := range liveResources {
		go watchResource(ctx, client.Resource(resource.gvr), resource, send)
	}
	go streamMetrics(ctx, clients, send)
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		pending := make([]LiveChange, 0)
		flush := func() {
			if len(pending) == 0 || ctx.Err() != nil {
				return
			}
			emit(LiveBatch{ConnectedAt: connectedAt, StreamID: streamID, Changes: pending})
			pending = nil
		}
		for {
			select {
			case <-ctx.Done():
				return
			case change := <-changes:
				pending = append(pending, change)
				if len(pending) >= 1000 {
					flush()
				}
			case <-ticker.C:
				flush()
			}
		}
	}()
	return nil
}

func (s *Service) stopLiveUpdatesLocked() {
	if s.liveCancel != nil {
		s.liveCancel()
		s.liveCancel = nil
	}
	s.liveStreamID = ""
}

func (s *Service) StopLiveUpdates(streamID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.liveStreamID == streamID {
		s.stopLiveUpdatesLocked()
	}
}

func liveDelay(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// List 建立版本基準；正常斷線從最後版本續接，410 則重新 List。
// 失敗保留前端資料；無 Watch 權限時以退避後的 List 維持降級同步。
func watchResource(ctx context.Context, client dynamic.ResourceInterface, resource liveResource, send func(LiveChange)) {
	version := ""
	listed := false
	backoff := time.Second
	for ctx.Err() == nil {
		if !listed {
			listCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			list, err := client.List(listCtx, metav1.ListOptions{})
			cancel()
			if err != nil {
				send(LiveChange{Section: resource.section, Type: "status", Error: resourceListError(resource.section, err).Error()})
				if !liveDelay(ctx, backoff) {
					return
				}
				backoff = min(backoff*2, 30*time.Second)
				continue
			}
			items := make([]map[string]interface{}, 0, len(list.Items))
			valid := true
			for _, obj := range list.Items {
				item, err := resource.project(obj)
				if err != nil {
					valid = false
					break
				}
				items = append(items, item)
			}
			if !valid {
				send(LiveChange{Section: resource.section, Type: "status", Error: "資源資料格式無法解析"})
				if !liveDelay(ctx, 30*time.Second) {
					return
				}
				continue
			}
			send(LiveChange{Section: resource.section, Type: "reset", Items: items})
			version, listed = list.GetResourceVersion(), true
		}
		started := time.Now()
		timeout := int64(300)
		stream, err := client.Watch(ctx, metav1.ListOptions{ResourceVersion: version, AllowWatchBookmarks: true, TimeoutSeconds: &timeout})
		if err == nil {
			send(LiveChange{Section: resource.section, Type: "status"})
			err = consumeWatch(ctx, stream, resource, &version, send)
		}
		if ctx.Err() != nil {
			return
		}
		// API Server 正常結束長連線時直接續接，不閃現中斷提示。
		if errors.Is(err, errLiveClosed) && time.Since(started) >= 240*time.Second {
			backoff = time.Second
			continue
		}
		if time.Since(started) >= 10*time.Second {
			backoff = time.Second
		}
		if err == nil {
			backoff = time.Second
			continue
		}
		send(LiveChange{Section: resource.section, Type: "status", Error: resourceListError(resource.section, err).Error()})
		if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) || apierrors.IsForbidden(err) {
			listed = false
		}
		if !liveDelay(ctx, backoff) {
			return
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func consumeWatch(ctx context.Context, stream watch.Interface, resource liveResource, version *string, send func(LiveChange)) error {
	defer stream.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event, ok := <-stream.ResultChan():
			if !ok {
				return errLiveClosed
			}
			if event.Type == watch.Error {
				return apierrors.FromObject(event.Object)
			}
			obj, ok := event.Object.(*unstructured.Unstructured)
			if !ok {
				return errors.New("監看資料格式無法解析")
			}
			if event.Type == watch.Bookmark {
				*version = obj.GetResourceVersion()
				continue
			}
			if event.Type != watch.Added && event.Type != watch.Modified && event.Type != watch.Deleted {
				continue
			}
			item, err := resource.project(*obj)
			if err != nil {
				return err
			}
			send(LiveChange{Section: resource.section, Type: string(event.Type), Item: item})
			*version = obj.GetResourceVersion()
		}
	}
}

// 指標與資源監看分開排程，只查詢 Metrics API，不重新 List 所有資源。
func streamMetrics(ctx context.Context, clients *clusterClients, send func(LiveChange)) {
	for ctx.Err() == nil {
		change := LiveChange{Section: "metrics", Type: "metrics"}
		if clients.metrics == nil {
			change.Error = "叢集未提供 Metrics API"
		} else {
			queryCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			nodes, nodeErr := clients.metrics.MetricsV1beta1().NodeMetricses().List(queryCtx, metav1.ListOptions{})
			pods, podErr := clients.metrics.MetricsV1beta1().PodMetricses("").List(queryCtx, metav1.ListOptions{})
			cancel()
			change.Error = metricsError(nodeErr, podErr)
			if change.Error == "" {
				for _, node := range nodes.Items {
					_, hasCPU := node.Usage[corev1.ResourceCPU]
					_, hasMemory := node.Usage[corev1.ResourceMemory]
					change.Items = append(change.Items, map[string]interface{}{"kind": "node", "name": node.Name, "metricsAvailable": hasCPU && hasMemory, "cpuUsageMilli": node.Usage.Cpu().MilliValue(), "memoryUsageBytes": node.Usage.Memory().Value()})
				}
				for _, pod := range pods.Items {
					var cpu, memory int64
					for _, container := range pod.Containers {
						cpu += container.Usage.Cpu().MilliValue()
						memory += container.Usage.Memory().Value()
					}
					change.Items = append(change.Items, map[string]interface{}{"kind": "pod", "name": pod.Name, "namespace": pod.Namespace, "cpuUsageMilli": cpu, "memoryUsageBytes": memory})
				}
			}
		}
		send(change)
		if !liveDelay(ctx, 15*time.Second) {
			return
		}
	}
}
