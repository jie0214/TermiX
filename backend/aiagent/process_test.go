package aiagent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestACPProcessCancellationNotifiesBeforeTermination(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "cancel-received")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p, err := startProcess(ctx, agentDefinition{id: "fixture", name: "ACP fixture"}, executable, []string{"-test.run=^TestACPProcessHelper$"}, func(string) ([]string, error) {
		return []string{"TERMIX_ACP_PROCESS_HELPER=" + marker}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	ready, stop := context.WithTimeout(ctx, 5*time.Second)
	defer stop()
	if _, err := p.rpc(ready, "initialize", nil, nil); err != nil {
		t.Fatal(err)
	}
	p.setCancelSession("owned-session")
	cancel()
	closed := make(chan struct{})
	go func() { p.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("取消後程序未結束")
	}
	data, err := os.ReadFile(marker)
	if err != nil || string(data) != "owned-session" {
		t.Fatalf("Agent 未收到 ACP 取消：%v", err)
	}
	p.Close()
	if _, err := os.Stat(p.dir); !os.IsNotExist(err) {
		t.Fatal("暫存目錄未清除")
	}
}

// 子程序 fixture 只回應協定訊息，不呼叫 CLI、模型或叢集。
func TestACPProcessHelper(t *testing.T) {
	marker := os.Getenv("TERMIX_ACP_PROCESS_HELPER")
	if marker == "" {
		t.Skip("僅由程序生命週期測試啟動")
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var m wireMessage
		if err := json.Unmarshal(scanner.Bytes(), &m); err != nil {
			os.Exit(2)
		}
		if m.text("method") == "session/cancel" {
			if err := os.WriteFile(marker, []byte(m.object("params").text("sessionId")), 0600); err != nil {
				os.Exit(3)
			}
			return
		}
		response, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": m["id"], "result": map[string]any{}})
		fmt.Println(string(response))
	}
}
