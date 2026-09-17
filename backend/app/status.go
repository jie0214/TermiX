package app

import (
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/jie0214/TermiX/backend/terminal"
	"github.com/jie0214/TermiX/shared/dto"
)

type StatusBarEntry struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type StatusBarSnapshot struct {
	Connections []StatusBarEntry `json:"connections"`
	Cluster     []string         `json:"cluster"`
	Forwards    []StatusBarEntry `json:"forwards"`
}

// NativeStatusBarSnapshot 直接讀取後端狀態，避免前端休眠時資訊過期。
// 使用 package function，避免增加不必要的 Wails binding。
func NativeStatusBarSnapshot(a *App) StatusBarSnapshot {
	return buildStatusBarSnapshot(a.terminal.ActiveConnections(), a.kubernetes.GetActiveSession(), a.kubernetes.ListPodPortForwards(dto.KubernetesPodPortForwardListRequest{}))
}

func buildStatusBarSnapshot(connections []terminal.ConnectionStatus, cluster *dto.KubernetesSession, forwards []dto.KubernetesPodPortForward) StatusBarSnapshot {
	snapshot := StatusBarSnapshot{Connections: []StatusBarEntry{}, Cluster: []string{}, Forwards: []StatusBarEntry{}}
	for _, connection := range connections {
		title := connection.Host
		if alias := strings.TrimSpace(connection.Alias); alias != "" {
			title = alias + " · " + connection.Host
		}
		snapshot.Connections = append(snapshot.Connections, StatusBarEntry{ID: connection.SessionKey, Title: title})
	}
	if cluster != nil {
		snapshot.Cluster = append(snapshot.Cluster, cluster.DisplayName+" · "+cluster.ContextName)
	}
	// 空篩選條件包含 Pod 與 Service 轉發，避免重複計數。
	for _, forward := range forwards {
		target := "Pod/" + forward.PodName
		if forward.ServiceName != "" {
			target = "Service/" + forward.ServiceName
		}
		snapshot.Forwards = append(snapshot.Forwards, StatusBarEntry{ID: forward.ID, Title: fmt.Sprintf("%s → %s/%s:%d · 執行中", net.JoinHostPort(forward.Address, strconv.Itoa(forward.LocalPort)), forward.Namespace, target, forward.RemotePort)})
	}
	return snapshot
}
