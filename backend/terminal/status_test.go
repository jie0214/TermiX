package terminal

import "testing"

func TestActiveConnectionsExcludesLocalAndClosedSessions(t *testing.T) {
	closed := make(chan struct{})
	close(closed)
	m := NewManager(nil)
	m.sessions["local"] = &session{isLocal: true}
	m.sessions["closed"] = &session{host: "closed", closed: closed}
	m.sessions["b"] = &session{host: "b.example", username: "root", port: 2222}
	m.sessions["a"] = &session{host: "a.example", alias: "正式環境", username: "deploy", port: 22}
	got := m.ActiveConnections()
	if len(got) != 2 || got[0].Host != "a.example" || got[0].Alias != "正式環境" || got[1].Port != 2222 {
		t.Fatalf("連線快照包含錯誤的工作階段或排序：%+v", got)
	}
	delete(m.sessions, "a")
	if len(m.ActiveConnections()) != 1 || len(got) != 2 {
		t.Fatal("連線快照未反映移除，或修改了先前快照")
	}
}

func TestCloseSelectedConnectionKeepsOtherSessionsOnSameHost(t *testing.T) {
	m := NewManager(nil)
	m.sessions["ssh-a"] = &session{host: "host", port: 22, closed: make(chan struct{})}
	m.sessions["ssh-b"] = &session{host: "host", port: 22, closed: make(chan struct{})}
	before := m.ActiveConnections()
	if len(before) != 2 || before[0].SessionKey != "ssh-a" || before[1].SessionKey != "ssh-b" {
		t.Fatalf("同主機的工作階段必須可個別識別：%+v", before)
	}
	m.Close(before[0].SessionKey)
	after := m.ActiveConnections()
	if len(after) != 1 || after[0].SessionKey != "ssh-b" {
		t.Fatalf("中斷指定連線不應影響其他工作階段：%+v", after)
	}
}
