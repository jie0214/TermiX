package terminal

import "testing"

func TestUpdateCountsLocalAndRemoteSessions(t *testing.T) {
	m := NewManager(nil)
	closed := make(chan struct{})
	close(closed)
	m.sessions["local"] = &session{isLocal: true, closed: make(chan struct{})}
	m.sessions["remote"] = &session{closed: make(chan struct{})}
	m.sessions["closed"] = &session{closed: closed}
	if count := m.ActiveSessionCount(); count != 2 {
		t.Fatalf("更新保護應計入本機與 SSH，得到 %d", count)
	}
}
