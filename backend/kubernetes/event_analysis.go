package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jie0214/TermiX/shared/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EventAnalysisSnapshot 重新讀取事件並核對 UID；關聯資源只投影狀態，不讀取 Secret 或完整 YAML。
func (s *Service) EventAnalysisSnapshot(ctx context.Context, request dto.EventAnalysisRequest) (dto.PodAnalysisSnapshot, error) {
	result := dto.PodAnalysisSnapshot{Evidence: []dto.PodAnalysisEvidence{}, Warnings: []string{}}
	clients, session, err := s.activeConnection()
	if err != nil {
		return result, err
	}
	if request.ConnectedAt == "" || request.ConnectedAt != session.ConnectedAt {
		return result, errors.New("Kubernetes 連線已變更，請重新開啟 Event")
	}
	if request.Namespace == "" || request.Namespace == "*" || request.EventName == "" || request.EventUID == "" {
		return result, errors.New("分析需要明確的 Namespace、Event 名稱與 UID")
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	event, err := clients.core.CoreV1().Events(request.Namespace).Get(ctx, request.EventName, metav1.GetOptions{})
	if err != nil {
		return result, resourceReadError("Event", err)
	}
	if string(event.UID) != request.EventUID {
		return result, errors.New("Event 已被替換，請重新開啟後分析")
	}
	result.Namespace, result.EventName, result.EventUID = event.Namespace, event.Name, string(event.UID)
	result.CapturedAt = time.Now().UTC().Format(time.RFC3339)
	add := func(title string, value any) {
		data, _ := json.MarshalIndent(value, "", "  ")
		content, truncated := limitAnalysisText(string(data), 64*1024)
		result.Evidence = append(result.Evidence, dto.PodAnalysisEvidence{Title: title, Content: content, Truncated: truncated})
	}
	add("Event 事件", map[string]any{"name": event.Name, "namespace": event.Namespace, "uid": event.UID, "type": event.Type, "reason": event.Reason, "message": event.Message, "count": event.Count, "firstTimestamp": event.FirstTimestamp, "lastTimestamp": event.LastTimestamp, "eventTime": event.EventTime, "series": event.Series, "source": event.Source, "reportingController": event.ReportingController, "involvedObject": event.InvolvedObject})
	ref := event.InvolvedObject
	if ref.Namespace == "" && ref.Kind != "Node" && ref.Kind != "PersistentVolume" {
		ref.Namespace = event.Namespace
	}
	related, relatedErr := eventRelatedStatus(ctx, clients, ref)
	if relatedErr != nil {
		result.Warnings = append(result.Warnings, "關聯資源狀態未取得："+relatedErr.Error())
	} else {
		add("關聯資源目前狀態", related)
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	_, current, err := s.activeConnection()
	if err != nil || current.ConnectedAt != session.ConnectedAt {
		return result, errors.New("Kubernetes 連線已變更，已停止分析")
	}
	latest, err := clients.core.CoreV1().Events(event.Namespace).Get(ctx, event.Name, metav1.GetOptions{})
	if err != nil || latest.UID != event.UID {
		return result, errors.New("Event 已變更或刪除，已停止分析")
	}
	return result, nil
}

func eventRelatedStatus(ctx context.Context, clients *clusterClients, ref corev1.ObjectReference) (any, error) {
	if ref.Name == "" || ref.UID == "" {
		return nil, errors.New("事件未提供關聯資源名稱或 UID，僅分析事件")
	}
	var object metav1.Object
	var status any
	var err error
	opts := metav1.GetOptions{}
	switch ref.Kind {
	case "Pod":
		if ref.APIVersion != "v1" {
			break
		}
		item, e := clients.core.CoreV1().Pods(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, analysisPod(item)
		}
	case "Node":
		if ref.APIVersion != "v1" {
			break
		}
		item, e := clients.core.CoreV1().Nodes().Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "Deployment":
		if ref.APIVersion != "apps/v1" {
			break
		}
		item, e := clients.core.AppsV1().Deployments(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "StatefulSet":
		if ref.APIVersion != "apps/v1" {
			break
		}
		item, e := clients.core.AppsV1().StatefulSets(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "DaemonSet":
		if ref.APIVersion != "apps/v1" {
			break
		}
		item, e := clients.core.AppsV1().DaemonSets(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "ReplicaSet":
		if ref.APIVersion != "apps/v1" {
			break
		}
		item, e := clients.core.AppsV1().ReplicaSets(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "Job":
		if ref.APIVersion != "batch/v1" {
			break
		}
		item, e := clients.core.BatchV1().Jobs(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "PersistentVolumeClaim":
		if ref.APIVersion != "v1" {
			break
		}
		item, e := clients.core.CoreV1().PersistentVolumeClaims(ref.Namespace).Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	case "PersistentVolume":
		if ref.APIVersion != "v1" {
			break
		}
		item, e := clients.core.CoreV1().PersistentVolumes().Get(ctx, ref.Name, opts)
		err = e
		if e == nil {
			object, status = item, item.Status
		}
	}
	if err != nil {
		return nil, resourceReadError(ref.Kind, err)
	}
	if object == nil {
		return nil, fmt.Errorf("%s %s 不在狀態讀取範圍，僅分析事件", ref.APIVersion, ref.Kind)
	}
	if object.GetUID() != ref.UID {
		return nil, errors.New("同名資源已被重新建立，未使用新資源狀態")
	}
	return map[string]any{"kind": ref.Kind, "name": object.GetName(), "namespace": object.GetNamespace(), "uid": object.GetUID(), "status": status}, nil
}
