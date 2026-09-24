package mobilessh_test

import (
	"encoding/json"
	ssh "github.com/jie0214/TermiX/mobile/ssh"
	"testing"
)

func TestRejectSecondSessionAndAllowAfterDisconnect(t *testing.T) {
	engine := ssh.NewEngine()
	config, _ := json.Marshal(map[string]any{"id": "one", "address": "192.0.2.1", "port": 22, "username": "test", "credentials": map[string]string{"type": "password", "password": "test-only"}, "cols": 80, "rows": 24})
	if err := engine.Start(string(config)); err != nil {
		t.Fatal(err)
	}
	if err := engine.Start(string(config)); err == nil {
		t.Fatal("第二個 session 不得建立")
	}
	engine.Disconnect("one")
	if err := engine.Start(string(config)); err != nil {
		t.Fatal(err)
	}
	engine.Disconnect("one")
}
