package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/jie0214/TermiX/shared/dto"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

type podShellEntry struct {
	cancel context.CancelFunc
	stdin  *io.PipeWriter
	sizes  *terminalSizeQueue
}

type terminalSizeQueue struct {
	mu     sync.Mutex
	latest *remotecommand.TerminalSize
	notify chan struct{}
	done   <-chan struct{}
}

func (q *terminalSizeQueue) Next() *remotecommand.TerminalSize {
	select {
	case <-q.done:
		return nil
	case <-q.notify:
		q.mu.Lock()
		size := q.latest
		q.latest = nil
		q.mu.Unlock()
		return size
	}
}

func (q *terminalSizeQueue) set(cols, rows uint16) {
	if cols == 0 || rows == 0 {
		return
	}
	q.mu.Lock()
	q.latest = &remotecommand.TerminalSize{Width: cols, Height: rows}
	q.mu.Unlock()
	select {
	case q.notify <- struct{}{}:
	default:
	}
}

type callbackWriter func([]byte)

func (w callbackWriter) Write(data []byte) (int, error) {
	w(append([]byte(nil), data...))
	return len(data), nil
}

// podShellCommand 建立互動式 Shell 指令。PS1 中保留 $PWD，讓提示字元於每次顯示時
// 使用目前目錄；帳號則由容器內的 id 指令取得，避免假設一定是 root。
func podShellCommand(podName string) []string {
	return []string{
		"/bin/sh",
		"-c",
		fmt.Sprintf("PS1=\"$(id -un)@%s:\\$PWD# \"; export PS1; exec /bin/sh -i", podName),
	}
}

func (s *Service) StartPodShell(ctx context.Context, request dto.KubernetesPodShellStartRequest, output func(string, string), closed func(string, string)) (dto.KubernetesPodShellSession, error) {
	clients, session, err := s.activeConnection()
	if err != nil {
		return dto.KubernetesPodShellSession{}, err
	}
	namespace := effectiveNamespace(request.Namespace, session.Namespace)
	podName := strings.TrimSpace(request.PodName)
	containerName := strings.TrimSpace(request.Container)
	if namespace == metav1.NamespaceAll || podName == "" || containerName == "" {
		return dto.KubernetesPodShellSession{}, errors.New("開啟 Pod Shell 必須指定 Namespace、Pod 與 Container")
	}
	pod, err := clients.core.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return dto.KubernetesPodShellSession{}, resourceReadError("Pod", err)
	}
	found := false
	for _, container := range pod.Spec.Containers {
		if container.Name == containerName {
			found = true
			break
		}
	}
	if !found {
		return dto.KubernetesPodShellSession{}, errors.New("開啟 Pod Shell 失敗：找不到指定 Container")
	}
	if pod.Status.Phase != corev1.PodRunning {
		return dto.KubernetesPodShellSession{}, errors.New("開啟 Pod Shell 失敗：Pod 目前不是 Running 狀態")
	}

	restClient := clients.core.CoreV1().RESTClient()
	if restClient == nil || clients.restConfig == nil {
		return dto.KubernetesPodShellSession{}, errors.New("Pod Shell 功能無法使用")
	}
	req := restClient.Post().Resource("pods").Namespace(namespace).Name(podName).SubResource("exec").VersionedParams(&corev1.PodExecOptions{
		Container: containerName, Command: podShellCommand(podName), Stdin: true, Stdout: true, Stderr: true, TTY: true,
	}, scheme.ParameterCodec)
	executor, err := remotecommand.NewSPDYExecutor(clients.restConfig, http.MethodPost, req.URL())
	if err != nil {
		return dto.KubernetesPodShellSession{}, errors.New("建立 Pod Shell 連線失敗：請檢查 pods/exec 權限與 API Server")
	}
	sessionID := uuid.NewString()
	streamCtx, cancel := context.WithCancel(context.Background())
	stdinReader, stdinWriter := io.Pipe()
	sizes := &terminalSizeQueue{notify: make(chan struct{}, 1), done: streamCtx.Done()}
	sizes.set(request.Cols, request.Rows)
	s.mu.Lock()
	if s.activeClients != clients {
		s.mu.Unlock()
		cancel()
		stdinReader.Close()
		stdinWriter.Close()
		return dto.KubernetesPodShellSession{}, errors.New("Kubernetes Cluster 已切換，Pod Shell 已取消")
	}
	s.podShells[sessionID] = &podShellEntry{cancel: cancel, stdin: stdinWriter, sizes: sizes}
	s.mu.Unlock()
	if output == nil {
		output = func(string, string) {}
	}
	if closed == nil {
		closed = func(string, string) {}
	}

	go func() {
		err := executor.StreamWithContext(streamCtx, remotecommand.StreamOptions{
			Stdin: stdinReader, Stdout: callbackWriter(func(data []byte) { output(sessionID, string(data)) }),
			Stderr: callbackWriter(func(data []byte) { output(sessionID, string(data)) }), Tty: true, TerminalSizeQueue: sizes,
		})
		stdinReader.Close()
		s.mu.Lock()
		delete(s.podShells, sessionID)
		s.mu.Unlock()
		message := ""
		if err != nil && !errors.Is(err, context.Canceled) {
			message = "Pod Shell 已中斷"
		}
		closed(sessionID, message)
	}()
	return dto.KubernetesPodShellSession{SessionID: sessionID, Namespace: namespace, PodName: podName, Container: containerName}, nil
}

func (s *Service) WritePodShell(request dto.KubernetesPodShellSessionRequest) error {
	s.mu.Lock()
	entry := s.podShells[strings.TrimSpace(request.SessionID)]
	s.mu.Unlock()
	if entry == nil {
		return errors.New("Pod Shell Session 不存在")
	}
	_, err := io.WriteString(entry.stdin, request.Data)
	return err
}

func (s *Service) ResizePodShell(request dto.KubernetesPodShellSessionRequest) error {
	s.mu.Lock()
	entry := s.podShells[strings.TrimSpace(request.SessionID)]
	s.mu.Unlock()
	if entry == nil {
		return errors.New("Pod Shell Session 不存在")
	}
	entry.sizes.set(request.Cols, request.Rows)
	return nil
}

func (s *Service) ClosePodShell(sessionID string) {
	s.mu.Lock()
	entry := s.podShells[strings.TrimSpace(sessionID)]
	delete(s.podShells, strings.TrimSpace(sessionID))
	s.mu.Unlock()
	if entry != nil {
		entry.cancel()
		entry.stdin.Close()
	}
}

func (s *Service) stopAllPodShellsLocked() {
	for id, entry := range s.podShells {
		entry.cancel()
		entry.stdin.Close()
		delete(s.podShells, id)
	}
}
