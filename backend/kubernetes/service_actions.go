package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
)

// StartServicePortForward 比照 kubectl port-forward svc/<name>：以 Service 的 selector
// 找一個 Running 的後端 Pod，把要求的 Service port 解析成 Pod 的 targetPort，再重用
// 既有的 Pod Port Forward 機制建立轉發。RemotePort 為「Service 連接埠」。
func (s *Service) StartServicePortForward(ctx context.Context, request dto.KubernetesServicePortForwardRequest) (dto.KubernetesPodPortForward, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesPodPortForward{}, err
	}
	namespace := effectiveNamespace(request.Namespace, session.Namespace)
	serviceName := strings.TrimSpace(request.ServiceName)
	if namespace == metav1.NamespaceAll || serviceName == "" {
		return dto.KubernetesPodPortForward{}, errors.New("Port Forward 必須指定 Namespace 與 Service 名稱")
	}
	if request.LocalPort < 0 || request.LocalPort > 65535 || request.RemotePort < 1 || request.RemotePort > 65535 {
		return dto.KubernetesPodPortForward{}, errors.New("Port Forward 連接埠必須介於 1 至 65535，本機連接埠可使用 0 自動分配")
	}

	getCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	svc, err := clients.core.CoreV1().Services(namespace).Get(getCtx, serviceName, metav1.GetOptions{})
	if err != nil {
		return dto.KubernetesPodPortForward{}, podActionError("建立 Service Port Forward", err)
	}
	if len(svc.Spec.Selector) == 0 {
		return dto.KubernetesPodPortForward{}, errors.New("此 Service 沒有 selector（可能為 headless 或以手動 Endpoints 管理），無法自動轉發")
	}

	// 找出所選 Service 連接埠對應的 targetPort。
	var targetPort intstr.IntOrString
	matched := false
	for _, p := range svc.Spec.Ports {
		if int(p.Port) == request.RemotePort {
			targetPort = p.TargetPort
			matched = true
			break
		}
	}
	if !matched {
		return dto.KubernetesPodPortForward{}, fmt.Errorf("Service %s 沒有連接埠 %d", serviceName, request.RemotePort)
	}

	// 依 selector 挑選一個可用的後端 Pod。
	podList, err := clients.core.CoreV1().Pods(namespace).List(getCtx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(svc.Spec.Selector).String(),
	})
	if err != nil {
		return dto.KubernetesPodPortForward{}, podActionError("建立 Service Port Forward", err)
	}
	pod := selectRunningPod(podList.Items)
	if pod == nil {
		return dto.KubernetesPodPortForward{}, errors.New("找不到可用（Running）的後端 Pod，無法建立 Service Port Forward")
	}

	// 解析 targetPort：數字直接使用；具名則到 Pod 容器埠對應成數字。
	podPort, err := resolveServiceTargetPort(pod, targetPort)
	if err != nil {
		return dto.KubernetesPodPortForward{}, err
	}

	starter := s.forwardStarter
	if starter == nil {
		starter = startPodPortForward
	}
	runtime, err := starter(clients, namespace, pod.Name, request.LocalPort, podPort)
	if err != nil {
		return dto.KubernetesPodPortForward{}, errors.New("建立 Service Port Forward 失敗：請檢查 pods/portforward 權限、API Server 與本機連接埠")
	}
	summary := dto.KubernetesPodPortForward{
		ID: uuid.NewString(), Namespace: namespace, PodName: pod.Name, ServiceName: serviceName,
		Address: podPortForwardAddress, LocalPort: runtime.localPort, RemotePort: request.RemotePort,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
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

// ListServicePortForwards 僅回傳「Service 類」的轉發（summary.ServiceName 非空），
// 依 namespace / serviceName 過濾。停止沿用 StopPodPortForward（以 ID 為準）。
func (s *Service) ListServicePortForwards(request dto.KubernetesServicePortForwardListRequest) []dto.KubernetesPodPortForward {
	s.mu.Lock()
	defer s.mu.Unlock()
	namespace := strings.TrimSpace(request.Namespace)
	serviceName := strings.TrimSpace(request.ServiceName)
	result := make([]dto.KubernetesPodPortForward, 0)
	for _, entry := range s.portForwards {
		if entry.summary.ServiceName == "" {
			continue
		}
		if namespace != "" && entry.summary.Namespace != namespace {
			continue
		}
		if serviceName != "" && entry.summary.ServiceName != serviceName {
			continue
		}
		result = append(result, entry.summary)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].LocalPort < result[j].LocalPort })
	return result
}

func selectRunningPod(pods []corev1.Pod) *corev1.Pod {
	for i := range pods {
		if pods[i].Status.Phase == corev1.PodRunning && pods[i].DeletionTimestamp == nil {
			return &pods[i]
		}
	}
	for i := range pods {
		if pods[i].DeletionTimestamp == nil {
			return &pods[i]
		}
	}
	return nil
}

func resolveServiceTargetPort(pod *corev1.Pod, target intstr.IntOrString) (int, error) {
	if target.Type == intstr.Int {
		return int(target.IntVal), nil
	}
	name := strings.TrimSpace(target.StrVal)
	if name == "" {
		return 0, errors.New("Service targetPort 無效")
	}
	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			if port.Name == name {
				return int(port.ContainerPort), nil
			}
		}
	}
	return 0, fmt.Errorf("後端 Pod %s 找不到具名連接埠 %q", pod.Name, name)
}
