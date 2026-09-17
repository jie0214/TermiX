package terminal

// ActiveSessionCount 包含本機終端，避免更新重啟中斷本機命令。
func (m *Manager) ActiveSessionCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, s := range m.sessions {
		select {
		case <-s.closed:
		default:
			count++
		}
	}
	return count
}

// CloseAll 等待資源釋放後才返回，避免 App 重啟時遺留本機子程序。
func (m *Manager) CloseAll() {
	m.mu.Lock()
	sessions := m.sessions
	m.sessions = make(map[string]*session)
	m.mu.Unlock()
	for _, session := range sessions {
		session.close()
	}
}
