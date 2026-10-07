package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jie0214/TermiX/shared/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
)

const analysisLogBytes = 64 * 1024

// PodAnalysisSnapshot 固定使用本次連線的 client，不在收集途中重新取 active client。
// 不沿用 Drawer YAML，因為該 YAML 包含環境變數明文。
func (s *Service) PodAnalysisSnapshot(ctx context.Context, request dto.PodAnalysisRequest) (dto.PodAnalysisSnapshot, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.PodAnalysisSnapshot{}, err
	}
	if request.ConnectedAt == "" || request.ConnectedAt != session.ConnectedAt {
		return dto.PodAnalysisSnapshot{}, errors.New("Kubernetes 連線已變更，請重新開啟 Pod")
	}
	if request.Namespace == "" || request.Namespace == "*" || request.PodName == "" || request.PodUID == "" {
		return dto.PodAnalysisSnapshot{}, errors.New("分析需要明確的 Namespace、Pod 名稱與 UID")
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	pod, err := clients.core.CoreV1().Pods(request.Namespace).Get(ctx, request.PodName, metav1.GetOptions{})
	if err != nil {
		return dto.PodAnalysisSnapshot{}, resourceReadError("Pod", err)
	}
	if string(pod.UID) != request.PodUID {
		return dto.PodAnalysisSnapshot{}, errors.New("Pod 已被重新建立，請重新開啟後分析")
	}
	result := dto.PodAnalysisSnapshot{Namespace: pod.Namespace, PodName: pod.Name, PodUID: string(pod.UID), CapturedAt: time.Now().UTC().Format(time.RFC3339), Evidence: []dto.PodAnalysisEvidence{}, Warnings: []string{}}
	data, err := json.MarshalIndent(analysisPod(pod), "", "  ")
	if err != nil {
		return result, err
	}
	if len(data) > 128*1024 {
		return result, errors.New("Pod 規格超過分析大小限制")
	}
	result.Evidence = append(result.Evidence, dto.PodAnalysisEvidence{Title: "Pod 狀態與規格", Content: string(data)})
	if request.IncludeEvents {
		events, eventErr := clients.core.CoreV1().Events(pod.Namespace).List(ctx, metav1.ListOptions{FieldSelector: fields.OneTermEqualSelector("involvedObject.uid", string(pod.UID)).String(), Limit: 100})
		if eventErr != nil {
			result.Warnings = append(result.Warnings, "Events 無法讀取："+resourceReadError("Events", eventErr).Error())
		} else {
			items := []dto.KubernetesEventSummary{}
			for _, event := range events.Items {
				// Fake client 與部分代理不一定套用 selector，仍以 UID 再檢查。
				if event.InvolvedObject.UID != pod.UID {
					continue
				}
				items = append(items, dto.KubernetesEventSummary{Type: event.Type, Reason: event.Reason, Message: event.Message, Count: event.Count, Timestamp: event.LastTimestamp.UTC().Format(time.RFC3339)})
				if len(items) >= 100 {
					break
				}
			}
			data, _ := json.MarshalIndent(items, "", "  ")
			text, truncated := limitAnalysisText(string(data), 64*1024)
			result.Evidence = append(result.Evidence, dto.PodAnalysisEvidence{Title: "Pod Events", Content: text, Truncated: truncated || events.Continue != "" || len(items) == 100})
		}
	}
	if request.IncludeLogs {
		if !analysisHasContainer(pod, request.Container) {
			return result, errors.New("請選擇此 Pod 的有效容器")
		}
		previous := false
		for _, status := range append(append([]corev1.ContainerStatus{}, pod.Status.ContainerStatuses...), pod.Status.InitContainerStatuses...) {
			if status.Name == request.Container && status.RestartCount > 0 {
				previous = true
			}
		}
		variants := []bool{false}
		if previous {
			variants = append(variants, true)
		}
		for _, prev := range variants {
			title := "目前容器日誌 · " + request.Container
			if prev {
				title = "上次容器日誌 · " + request.Container
			}
			if clients.podLogs == nil {
				result.Warnings = append(result.Warnings, title+"：日誌功能無法使用")
				continue
			}
			tail, limit := int64(200), int64(analysisLogBytes)
			stream, logErr := clients.podLogs(ctx, pod.Namespace, pod.Name, &corev1.PodLogOptions{Container: request.Container, TailLines: &tail, LimitBytes: &limit, Previous: prev, Timestamps: true})
			if logErr != nil {
				result.Warnings = append(result.Warnings, title+"："+resourceReadError("Logs", logErr).Error())
				continue
			}
			bytes, readErr := io.ReadAll(io.LimitReader(stream, analysisLogBytes+1))
			_ = stream.Close()
			if readErr != nil {
				result.Warnings = append(result.Warnings, title+"：讀取失敗")
				continue
			}
			content, truncated := limitAnalysisText(string(bytes), analysisLogBytes)
			result.Evidence = append(result.Evidence, dto.PodAnalysisEvidence{Title: title, Content: content, Truncated: truncated || len(bytes) >= analysisLogBytes})
		}
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	// 讀取期間若切換叢集或 Pod 被替換，不把過期快照送進 Agent。
	_, current, err := s.activeConnection()
	if err != nil || current.ConnectedAt != session.ConnectedAt {
		return result, errors.New("Kubernetes 連線已變更，已停止分析")
	}
	latest, err := clients.core.CoreV1().Pods(pod.Namespace).Get(ctx, pod.Name, metav1.GetOptions{})
	if err != nil || latest.UID != pod.UID {
		return result, errors.New("Pod 已變更或刪除，已停止分析")
	}
	return result, nil
}

func analysisHasContainer(pod *corev1.Pod, name string) bool {
	for _, container := range append(append([]corev1.Container{}, pod.Spec.Containers...), pod.Spec.InitContainers...) {
		if container.Name == name {
			return true
		}
	}
	return false
}

func analysisPod(pod *corev1.Pod) map[string]any {
	containers := func(items []corev1.Container) []map[string]any {
		result := []map[string]any{}
		for _, c := range items {
			env := []map[string]string{}
			for _, v := range c.Env {
				source := envVarSource(v)
				if source == "" {
					source = "literal (value omitted)"
				}
				env = append(env, map[string]string{"name": v.Name, "source": source})
			}
			result = append(result, map[string]any{"name": c.Name, "image": c.Image, "resources": c.Resources, "ports": c.Ports, "env": env, "envFrom": containerEnvFrom(c), "hasReadinessProbe": c.ReadinessProbe != nil, "hasLivenessProbe": c.LivenessProbe != nil, "hasStartupProbe": c.StartupProbe != nil})
		}
		return result
	}
	return map[string]any{
		"metadata": map[string]any{"name": pod.Name, "namespace": pod.Namespace, "uid": pod.UID, "createdAt": pod.CreationTimestamp, "owners": pod.OwnerReferences},
		"spec":     map[string]any{"nodeName": pod.Spec.NodeName, "restartPolicy": pod.Spec.RestartPolicy, "serviceAccountName": pod.Spec.ServiceAccountName, "containers": containers(pod.Spec.Containers), "initContainers": containers(pod.Spec.InitContainers)},
		"status":   pod.Status,
	}
}

func limitAnalysisText(text string, limit int) (string, bool) {
	if len(text) <= limit {
		return strings.ToValidUTF8(text, ""), false
	}
	return strings.ToValidUTF8(text[:limit], "") + fmt.Sprintf("\n[內容已截斷，最多 %d bytes]", limit), true
}
