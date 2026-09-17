package terminal

import "sort"

// ConnectionStatus 僅包含選單列需要的連線資訊，不攜帶驗證資料。
type ConnectionStatus struct {
	SessionKey string `json:"sessionKey"`
	Alias      string `json:"alias"`
	Host       string `json:"host"`
	Username   string `json:"username"`
	Port       int    `json:"port"`
}

func (m *Manager) ActiveConnections() []ConnectionStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]ConnectionStatus, 0)
	for key, session := range m.sessions {
		if session.isLocal {
			continue
		}
		select {
		case <-session.closed:
			continue
		default:
		}
		result = append(result, ConnectionStatus{SessionKey: key, Alias: session.alias, Host: session.host, Username: session.username, Port: session.port})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Host != result[j].Host {
			return result[i].Host < result[j].Host
		}
		if result[i].Username != result[j].Username {
			return result[i].Username < result[j].Username
		}
		if result[i].Port != result[j].Port {
			return result[i].Port < result[j].Port
		}
		return result[i].SessionKey < result[j].SessionKey
	})
	return result
}
