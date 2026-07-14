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
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/yaml"
)

// workloadPodTemplateKinds：具 pod template 的工作負載（env 來自 spec.template.spec.containers）。
var workloadPodTemplateKinds = map[string]struct{}{
	"deployment": {}, "statefulset": {}, "daemonset": {}, "replicaset": {},
}

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
		// events 改由前端於抽屜開啟後獨立呼叫 GetKubernetesResourceEvents 非同步載入，不阻塞 detail。
		return detail, nil
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
	// events 同上，改為前端非同步載入（前端以 detail.namespace 查詢；cluster-scoped 為空 → 跨 namespace）。
	return detail, nil
}

// listResourceEvents 以 best-effort 查詢資源相關 Events（供獨立的 ResourceEvents 使用）。
// namespace 為空（cluster-scoped）時等同 NamespaceAll，跨 namespace 查 Events。
func (s *Service) listResourceEvents(ctx context.Context, clients *clusterClients, namespace, kind, name, uid string) ([]dto.KubernetesEventSummary, error) {
	selector := fields.OneTermEqualSelector("involvedObject.uid", uid)
	if uid == "" {
		selector = fields.AndSelectors(
			fields.OneTermEqualSelector("involvedObject.kind", kind),
			fields.OneTermEqualSelector("involvedObject.name", name),
		)
	}
	events, err := clients.core.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{FieldSelector: selector.String()})
	if err != nil {
		return nil, err
	}
	result := make([]dto.KubernetesEventSummary, 0, len(events.Items))
	for _, event := range events.Items {
		if (uid != "" && string(event.InvolvedObject.UID) == uid) ||
			(uid == "" && strings.EqualFold(event.InvolvedObject.Kind, kind) && event.InvolvedObject.Name == name) {
			result = append(result, eventSummary(event))
		}
	}
	sortEvents(result)
	return result, nil
}

// ResourceEvents 獨立查詢某資源的相關事件（與 detail 分離，供抽屜開啟後非同步延後載入）。
// best-effort：查詢失敗只填 EventsError，不使整體失敗。
func (s *Service) ResourceEvents(ctx context.Context, request dto.KubernetesResourceEventsRequest) (dto.KubernetesResourceEvents, error) {
	clients, _, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesResourceEvents{}, err
	}
	kind := strings.TrimSpace(request.Kind)
	name := strings.TrimSpace(request.Name)
	uid := strings.TrimSpace(request.UID)
	if name == "" && uid == "" {
		return dto.KubernetesResourceEvents{}, errors.New("讀取資源事件時必須指定名稱或 UID")
	}
	// namespace：前端傳入該資源所在 namespace；cluster-scoped 為空 → 跨 namespace。
	namespace := strings.TrimSpace(request.Namespace)
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result := dto.KubernetesResourceEvents{Events: []dto.KubernetesEventSummary{}}
	events, err := s.listResourceEvents(ctx, clients, namespace, kind, name, uid)
	if err != nil {
		result.EventsError = resourceReadError("Events", err).Error()
		return result, nil
	}
	result.Events = events
	return result, nil
}

// SecretValue 於使用者明確要求時，取回單一 Secret data key 的明文值（client-go 已 base64 解碼）。
func (s *Service) SecretValue(ctx context.Context, request dto.KubernetesSecretValueRequest) (dto.KubernetesSecretValue, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesSecretValue{}, err
	}
	name := strings.TrimSpace(request.Name)
	key := strings.TrimSpace(request.Key)
	if name == "" || key == "" {
		return dto.KubernetesSecretValue{}, errors.New("讀取 Secret 值時必須指定名稱與 key")
	}
	namespace := effectiveNamespace(request.Namespace, session.Namespace)
	if namespace == metav1.NamespaceAll {
		return dto.KubernetesSecretValue{}, errors.New("讀取 Secret 值時必須指定 Namespace")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	secret, err := clients.core.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return dto.KubernetesSecretValue{}, resourceReadError("Secret", err)
	}
	value, ok := secret.Data[key]
	if !ok {
		return dto.KubernetesSecretValue{}, fmt.Errorf("Secret %s 不含 data key：%s", name, key)
	}
	return dto.KubernetesSecretValue{Key: key, Value: string(value)}, nil
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
			Env: containerEnvSummary(container), EnvFrom: containerEnvFrom(container),
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
	// 註：env 值不遮罩，照實輸出（使用者需檢視自身 workload 的環境變數）。
	content, err := yaml.Marshal(pod)
	if err != nil {
		return ""
	}
	return string(content)
}

// unstructuredContainers 從工作負載（Deployment/StatefulSet/DaemonSet/ReplicaSet）的
// spec.template.spec.containers 取出容器並轉為 detail（供 ENV 頁籤顯示）。非工作負載回傳空。
// 這些是 pod 範本，無執行期狀態，故 Ready/State 留空（前端據此不顯示狀態徽章）。
func unstructuredContainers(obj *unstructured.Unstructured) []dto.KubernetesContainerDetail {
	if _, ok := workloadPodTemplateKinds[strings.ToLower(obj.GetKind())]; !ok {
		return []dto.KubernetesContainerDetail{}
	}
	raw, found, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
	if !found {
		return []dto.KubernetesContainerDetail{}
	}
	result := make([]dto.KubernetesContainerDetail, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		var container corev1.Container
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(m, &container); err != nil {
			continue
		}
		result = append(result, dto.KubernetesContainerDetail{
			Name: container.Name, Image: container.Image,
			Env: containerEnvSummary(container), EnvFrom: containerEnvFrom(container),
		})
	}
	return result
}

// containerEnvSummary 產生消毒後的 env 摘要（名稱 + 來源，不含實際值）。
func containerEnvSummary(container corev1.Container) []dto.KubernetesEnvVarSummary {
	result := make([]dto.KubernetesEnvVarSummary, 0, len(container.Env))
	for _, env := range container.Env {
		result = append(result, dto.KubernetesEnvVarSummary{Name: env.Name, Value: env.Value, Source: envVarSource(env)})
	}
	return result
}

// envVarSource 僅描述 valueFrom 的來源；字面值以 Value 直接呈現，故回傳空字串。
func envVarSource(env corev1.EnvVar) string {
	if env.ValueFrom != nil {
		switch {
		case env.ValueFrom.SecretKeyRef != nil:
			return fmt.Sprintf("Secret %s / %s", env.ValueFrom.SecretKeyRef.Name, env.ValueFrom.SecretKeyRef.Key)
		case env.ValueFrom.ConfigMapKeyRef != nil:
			return fmt.Sprintf("ConfigMap %s / %s", env.ValueFrom.ConfigMapKeyRef.Name, env.ValueFrom.ConfigMapKeyRef.Key)
		case env.ValueFrom.FieldRef != nil:
			return fmt.Sprintf("fieldRef %s", env.ValueFrom.FieldRef.FieldPath)
		case env.ValueFrom.ResourceFieldRef != nil:
			return fmt.Sprintf("resourceFieldRef %s", env.ValueFrom.ResourceFieldRef.Resource)
		}
		return "valueFrom"
	}
	return ""
}

// containerEnvFrom 產生 envFrom 的來源清單（ConfigMap / Secret 名稱；皆為參照非值）。
func containerEnvFrom(container corev1.Container) []string {
	result := make([]string, 0, len(container.EnvFrom))
	for _, source := range container.EnvFrom {
		switch {
		case source.SecretRef != nil:
			result = append(result, fmt.Sprintf("Secret %s", source.SecretRef.Name))
		case source.ConfigMapRef != nil:
			result = append(result, fmt.Sprintf("ConfigMap %s", source.ConfigMapRef.Name))
		}
	}
	return result
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
		Containers: unstructuredContainers(obj),
		Events:     []dto.KubernetesEventSummary{},
	}
	detail.CreatedAt = obj.GetCreationTimestamp().UTC().Format(time.RFC3339)
	if obj.GetKind() == "Secret" {
		detail.SecretType, _, _ = unstructured.NestedString(obj.Object, "type")
		if data, found, _ := unstructured.NestedMap(obj.Object, "data"); found {
			keys := make([]string, 0, len(data))
			for key := range data {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			detail.SecretDataKeys = keys
		}
	}
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
