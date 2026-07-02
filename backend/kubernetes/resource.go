package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"sigs.k8s.io/yaml"
)

const (
	maxKubernetesMessageBytes = 1000
	maxPodLogBytes            = 1024 * 1024
)

func (s *Service) ResourceDetail(ctx context.Context, request dto.KubernetesResourceDetailRequest) (dto.KubernetesResourceDetail, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesResourceDetail{}, err
	}
	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	name := strings.TrimSpace(request.Name)
	if name == "" {
		return dto.KubernetesResourceDetail{}, errors.New("Kubernetes 資源名稱不可為空")
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Pod 維持既有 typed 路徑（含 sanitizedPodYAML、containers、stale-namespace 校正）。
	if kind == "pod" {
		namespace := effectiveNamespace(request.Namespace, session.Namespace)
		if namespace == metav1.NamespaceAll {
			return dto.KubernetesResourceDetail{}, errors.New("讀取資源詳細資料時必須指定 Namespace")
		}
		item, getErr := clients.core.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
		if apierrors.IsNotFound(getErr) {
			matches, listErr := clients.core.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{
				FieldSelector: fields.OneTermEqualSelector("metadata.name", name).String(),
			})
			if listErr == nil && len(matches.Items) == 1 {
				item = matches.Items[0].DeepCopy()
				namespace = item.Namespace
				getErr = nil
			}
		}
		if getErr != nil {
			return dto.KubernetesResourceDetail{}, resourceReadError("Pod", getErr)
		}
		detail := podDetail(*item)
		return s.attachResourceEvents(ctx, clients, detail, namespace, string(item.UID)), nil
	}

	// 其他所有 kind 走泛用路徑：GVK → RESTMapping → dynamic Get → unstructured 組 detail。
	gvk, err := requestGVK(request.APIVersion, request.Kind)
	if err != nil {
		return dto.KubernetesResourceDetail{}, err
	}
	if clients.dynamic == nil || clients.restMapper == nil {
		return dto.KubernetesResourceDetail{}, errors.New("目前連線不支援動態讀取資源")
	}
	mapping, err := resolveRESTMapping(clients.restMapper, gvk)
	if err != nil {
		return dto.KubernetesResourceDetail{}, resourceReadError(gvk.Kind, err)
	}
	clusterScoped := mapping.Scope.Name() != meta.RESTScopeNameNamespace
	namespace := ""
	if !clusterScoped {
		namespace = effectiveNamespace(request.Namespace, session.Namespace)
		if namespace == metav1.NamespaceAll {
			return dto.KubernetesResourceDetail{}, errors.New("讀取資源詳細資料時必須指定 Namespace")
		}
	}
	resource := clients.dynamic.Resource(mapping.Resource)
	var obj *unstructured.Unstructured
	if clusterScoped {
		obj, err = resource.Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = resource.Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		return dto.KubernetesResourceDetail{}, resourceReadError(gvk.Kind, err)
	}
	detail := unstructuredDetail(obj)
	return s.attachResourceEvents(ctx, clients, detail, namespace, detail.UID), nil
}

// attachResourceEvents 以 best-effort 方式補上資源相關 Events；失敗時填 EventsError 而不使整個 detail 失敗。
func (s *Service) attachResourceEvents(ctx context.Context, clients *clusterClients, detail dto.KubernetesResourceDetail, namespace, uid string) dto.KubernetesResourceDetail {
	// namespace 為空（cluster-scoped）時等同 NamespaceAll，跨 namespace 查 Events。
	selector := fields.OneTermEqualSelector("involvedObject.uid", uid)
	if uid == "" {
		selector = fields.AndSelectors(
			fields.OneTermEqualSelector("involvedObject.kind", detail.Kind),
			fields.OneTermEqualSelector("involvedObject.name", detail.Name),
		)
	}
	events, eventErr := clients.core.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{FieldSelector: selector.String()})
	if eventErr != nil {
		detail.EventsError = resourceReadError("Events", eventErr).Error()
		return detail
	}
	for _, event := range events.Items {
		if (uid != "" && string(event.InvolvedObject.UID) == uid) ||
			(uid == "" && strings.EqualFold(event.InvolvedObject.Kind, detail.Kind) && event.InvolvedObject.Name == detail.Name) {
			detail.Events = append(detail.Events, eventSummary(event))
		}
	}
	sortEvents(detail.Events)
	return detail
}

func (s *Service) PodLogs(ctx context.Context, request dto.KubernetesPodLogsRequest) (dto.KubernetesPodLogs, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesPodLogs{}, err
	}
	namespace := effectiveNamespace(request.Namespace, session.Namespace)
	if namespace == metav1.NamespaceAll {
		return dto.KubernetesPodLogs{}, errors.New("讀取 Pod Logs 時必須指定 Namespace")
	}
	podName := strings.TrimSpace(request.PodName)
	container := strings.TrimSpace(request.Container)
	if podName == "" || container == "" {
		return dto.KubernetesPodLogs{}, errors.New("Pod 名稱與 Container 均為必填")
	}
	tailLines := request.TailLines
	if tailLines == 0 {
		tailLines = 200
	}
	if tailLines < 1 || tailLines > 1000 {
		return dto.KubernetesPodLogs{}, errors.New("Pod Logs tailLines 必須介於 1 至 1000")
	}
	if clients.podLogs == nil {
		return dto.KubernetesPodLogs{}, errors.New("Pod Logs 讀取功能無法使用")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	stream, err := clients.podLogs(ctx, namespace, podName, &corev1.PodLogOptions{
		Container: container,
		Previous:  request.Previous,
		TailLines: &tailLines,
	})
	if err != nil {
		return dto.KubernetesPodLogs{}, resourceReadError("Pod Logs", err)
	}
	defer stream.Close()
	content, err := io.ReadAll(io.LimitReader(stream, maxPodLogBytes+1))
	if err != nil {
		return dto.KubernetesPodLogs{}, errors.New("讀取 Pod Logs 失敗：請檢查網路與 API Server")
	}
	truncated := len(content) > maxPodLogBytes
	if truncated {
		content = content[:maxPodLogBytes]
		for !utf8.Valid(content) {
			content = content[:len(content)-1]
		}
	}
	return dto.KubernetesPodLogs{Container: container, Content: string(content), Truncated: truncated}, nil
}

func (s *Service) activeConnection() (*clusterClients, dto.KubernetesSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeSession == nil || s.activeClients == nil {
		return nil, dto.KubernetesSession{}, errors.New("尚未連接 Kubernetes Cluster")
	}
	return s.activeClients, *s.activeSession, nil
}

func effectiveNamespace(requested, fallback string) string {
	namespace := strings.TrimSpace(requested)
	if namespace == "" {
		namespace = strings.TrimSpace(fallback)
	}
	if namespace == "" {
		return "default"
	}
	if namespace == "*" {
		return metav1.NamespaceAll
	}
	return namespace
}

func resourceReadError(resource string, err error) error {
	switch {
	case apierrors.IsForbidden(err):
		return fmt.Errorf("讀取 %s 失敗：目前 kubeconfig 身分沒有存取權限", resource)
	case apierrors.IsUnauthorized(err):
		return fmt.Errorf("讀取 %s 失敗：Kubernetes 認證已失效", resource)
	case apierrors.IsNotFound(err):
		return fmt.Errorf("讀取 %s 失敗：找不到指定資源", resource)
	default:
		return fmt.Errorf("讀取 %s 失敗：請檢查網路、API Server 與 kubeconfig 認證設定", resource)
	}
}

// baseDetail 現僅供 Pod typed 路徑使用（apiVersion 固定為 v1）；其餘 kind 走 unstructuredDetail。
func baseDetail(kind, name, namespace, status string, metadata metav1.ObjectMeta) dto.KubernetesResourceDetail {
	return dto.KubernetesResourceDetail{
		Kind: kind, Name: name, Namespace: namespace, Status: status,
		UID:        string(metadata.UID),
		APIVersion: "v1",
		CreatedAt:  metadata.CreationTimestamp.UTC().Format(time.RFC3339),
		Labels:     sortedKeyValues(metadata.Labels),
		Owners:     ownerReferences(metadata.OwnerReferences),
		Fields:     []dto.KubernetesKeyValue{}, Conditions: []dto.KubernetesResourceCondition{},
		Containers: []dto.KubernetesContainerDetail{}, Events: []dto.KubernetesEventSummary{},
	}
}

func podDetail(item corev1.Pod) dto.KubernetesResourceDetail {
	detail := baseDetail("Pod", item.Name, item.Namespace, string(item.Status.Phase), item.ObjectMeta)
	detail.YAML = sanitizedPodYAML(item)
	detail.Fields = keyValues("Node", item.Spec.NodeName, "Pod IP", item.Status.PodIP, "Host IP", item.Status.HostIP, "Service Account", item.Spec.ServiceAccountName, "QoS Class", string(item.Status.QOSClass))
	statusByName := make(map[string]corev1.ContainerStatus, len(item.Status.ContainerStatuses))
	for _, status := range item.Status.ContainerStatuses {
		statusByName[status.Name] = status
	}
	for _, container := range item.Spec.Containers {
		status := statusByName[container.Name]
		detail.Containers = append(detail.Containers, dto.KubernetesContainerDetail{
			Name: container.Name, Image: container.Image, Ready: status.Ready,
			RestartCount: status.RestartCount, State: containerState(status.State), Ports: containerPorts(container.Ports),
		})
	}
	for _, condition := range item.Status.Conditions {
		detail.Conditions = append(detail.Conditions, conditionDetail(string(condition.Type), string(condition.Status), condition.Reason, condition.Message, condition.LastTransitionTime))
	}
	return detail
}

func ownerReferences(values []metav1.OwnerReference) []dto.KubernetesOwnerReference {
	result := make([]dto.KubernetesOwnerReference, 0, len(values))
	for _, value := range values {
		result = append(result, dto.KubernetesOwnerReference{
			APIVersion: value.APIVersion,
			Kind:       value.Kind,
			Name:       value.Name,
			UID:        string(value.UID),
			Controller: value.Controller != nil && *value.Controller,
		})
	}
	return result
}

func containerPorts(values []corev1.ContainerPort) []dto.KubernetesContainerPort {
	result := make([]dto.KubernetesContainerPort, 0, len(values))
	for _, value := range values {
		result = append(result, dto.KubernetesContainerPort{
			Name: value.Name, Port: value.ContainerPort, Protocol: string(value.Protocol),
		})
	}
	return result
}

func sanitizedPodYAML(item corev1.Pod) string {
	pod := item.DeepCopy()
	pod.TypeMeta = metav1.TypeMeta{APIVersion: "v1", Kind: "Pod"}
	pod.ManagedFields = nil
	pod.Annotations = nil
	for index := range pod.Spec.InitContainers {
		pod.Spec.InitContainers[index].Env = nil
		pod.Spec.InitContainers[index].EnvFrom = nil
	}
	for index := range pod.Spec.Containers {
		pod.Spec.Containers[index].Env = nil
		pod.Spec.Containers[index].EnvFrom = nil
	}
	for index := range pod.Spec.EphemeralContainers {
		pod.Spec.EphemeralContainers[index].Env = nil
		pod.Spec.EphemeralContainers[index].EnvFrom = nil
	}
	content, err := yaml.Marshal(pod)
	if err != nil {
		return ""
	}
	return string(content)
}

// unstructuredDetail 由泛用 unstructured 物件組出 KubernetesResourceDetail。
// 適用於 Pod 以外的所有 kind；YAML 走 sanitizedUnstructuredYAML（保留 resourceVersion 供樂觀鎖）。
func unstructuredDetail(obj *unstructured.Unstructured) dto.KubernetesResourceDetail {
	status := ""
	if phase, found, _ := unstructured.NestedString(obj.Object, "status", "phase"); found {
		status = phase
	}
	detail := dto.KubernetesResourceDetail{
		Kind:       obj.GetKind(),
		Name:       obj.GetName(),
		Namespace:  obj.GetNamespace(),
		Status:     status,
		UID:        string(obj.GetUID()),
		APIVersion: obj.GetAPIVersion(),
		YAML:       sanitizedUnstructuredYAML(obj),
		Labels:     sortedKeyValues(obj.GetLabels()),
		Owners:     ownerReferences(obj.GetOwnerReferences()),
		Fields:     []dto.KubernetesKeyValue{},
		Conditions: []dto.KubernetesResourceCondition{},
		Containers: []dto.KubernetesContainerDetail{},
		Events:     []dto.KubernetesEventSummary{},
	}
	detail.CreatedAt = obj.GetCreationTimestamp().UTC().Format(time.RFC3339)
	if conditions, found, _ := unstructured.NestedSlice(obj.Object, "status", "conditions"); found {
		for _, raw := range conditions {
			condition, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			conditionType, _, _ := unstructured.NestedString(condition, "type")
			conditionStatus, _, _ := unstructured.NestedString(condition, "status")
			reason, _, _ := unstructured.NestedString(condition, "reason")
			message, _, _ := unstructured.NestedString(condition, "message")
			detail.Conditions = append(detail.Conditions, dto.KubernetesResourceCondition{
				Type: conditionType, Status: conditionStatus, Reason: reason, Message: limitedText(message),
			})
		}
	}
	return detail
}

// sanitizedUnstructuredYAML 產生可供檢視/編輯的 YAML：
// 移除 metadata.managedFields（噪音），保留 resourceVersion 供更新樂觀鎖；
// Secret 的 data 與 stringData 值遮蔽為 ***REDACTED***（保留 key 名），確保機密不外洩。
func sanitizedUnstructuredYAML(obj *unstructured.Unstructured) string {
	clone := obj.DeepCopy()
	unstructured.RemoveNestedField(clone.Object, "metadata", "managedFields")
	if clone.GetKind() == "Secret" {
		redactSecretValues(clone.Object, "data")
		redactSecretValues(clone.Object, "stringData")
	}
	content, err := yaml.Marshal(clone.Object)
	if err != nil {
		return ""
	}
	return string(content)
}

// redactSecretValues 把 Secret 指定欄位（data / stringData）的每個值換成遮蔽字串，保留 key 名。
func redactSecretValues(object map[string]interface{}, field string) {
	values, found, _ := unstructured.NestedMap(object, field)
	if !found {
		return
	}
	for key := range values {
		values[key] = "***REDACTED***"
	}
	_ = unstructured.SetNestedField(object, values, field)
}

func containerState(state corev1.ContainerState) string {
	switch {
	case state.Running != nil:
		return "Running"
	case state.Waiting != nil:
		return "Waiting"
	case state.Terminated != nil:
		return "Terminated"
	default:
		return "Unknown"
	}
}

func conditionDetail(kind, status, reason, message string, transition metav1.Time) dto.KubernetesResourceCondition {
	return dto.KubernetesResourceCondition{Type: kind, Status: status, Reason: reason, Message: limitedText(message), LastTransitionTime: transition.UTC().Format(time.RFC3339)}
}

func sortedKeyValues(values map[string]string) []dto.KubernetesKeyValue {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]dto.KubernetesKeyValue, 0, len(keys))
	for _, key := range keys {
		result = append(result, dto.KubernetesKeyValue{Key: key, Value: values[key]})
	}
	return result
}

func keyValues(values ...string) []dto.KubernetesKeyValue {
	result := make([]dto.KubernetesKeyValue, 0, len(values)/2)
	for index := 0; index+1 < len(values); index += 2 {
		result = append(result, dto.KubernetesKeyValue{Key: values[index], Value: values[index+1]})
	}
	return result
}

func eventSummary(item corev1.Event) dto.KubernetesEventSummary {
	timestamp := item.EventTime.Time
	if timestamp.IsZero() {
		timestamp = item.LastTimestamp.Time
	}
	if timestamp.IsZero() {
		timestamp = item.FirstTimestamp.Time
	}
	if timestamp.IsZero() {
		timestamp = item.CreationTimestamp.Time
	}
	return dto.KubernetesEventSummary{
		Type: item.Type, Reason: item.Reason, Message: limitedText(item.Message),
		Object:    item.InvolvedObject.Kind + "/" + item.InvolvedObject.Name,
		Namespace: item.Namespace, Count: item.Count, Timestamp: timestamp.UTC().Format(time.RFC3339),
	}
}

func limitedText(value string) string {
	if len(value) <= maxKubernetesMessageBytes {
		return value
	}
	value = value[:maxKubernetesMessageBytes]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}

func sortEvents(events []dto.KubernetesEventSummary) {
	sort.SliceStable(events, func(i, j int) bool { return events[i].Timestamp > events[j].Timestamp })
}
