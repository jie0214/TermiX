package aiagent

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/jie0214/TermiX/shared/dto"
)

type wireWriter struct {
	onWrite  func(wireMessage)
	mu       sync.Mutex
	messages []wireMessage
}

func (w *wireWriter) Write(data []byte) (int, error) {
	var m wireMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return 0, err
	}
	w.mu.Lock()
	w.messages = append(w.messages, m)
	w.mu.Unlock()
	w.onWrite(m)
	return len(data), nil
}
func (w *wireWriter) Close() error { return nil }
func message(value any) wireMessage {
	bytes, _ := json.Marshal(value)
	var result wireMessage
	_ = json.Unmarshal(bytes, &result)
	return result
}
func fakeProcess(handler func(wireMessage, chan wireMessage)) (*process, *wireWriter) {
	p := &process{messages: make(chan wireMessage, 32), dir: "/tmp/termix-test"}
	w := &wireWriter{onWrite: func(m wireMessage) { handler(m, p.messages) }}
	p.input = w
	return p, w
}

// 明確 opt-in，僅查詢握手與模型清單，不送出推論或 Pod 資料。
func TestLocalAgentModels(t *testing.T) {
	id := os.Getenv("TERMIX_AI_LOCAL_TEST")
	if id == "" {
		t.Skip("需要 TERMIX_AI_LOCAL_TEST 指定本機 Agent")
	}
	def, err := definition(id)
	if err != nil {
		t.Fatal(err)
	}
	path, err := localACPPath(def)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	client, err := openAdapter(ctx, def, path)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	models, err := client.Models(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeModels(models); err != nil {
		t.Fatal(err)
	}
	t.Logf("%s 回傳 %d 個模型", def.name, len(models))
}

func TestBoundedTextKeepsUTF8(t *testing.T) {
	got := boundedText(strings.Repeat("測", 100), 10)
	if strings.ContainsRune(got, '\uFFFD') {
		t.Fatal(got)
	}
}

// 額外 opt-in 的端到端推論只使用人工資料，不存取叢集。
func TestLocalAgentAnalysis(t *testing.T) {
	id := os.Getenv("TERMIX_AI_ANALYSIS_TEST")
	if id == "" {
		t.Skip("需要 TERMIX_AI_ANALYSIS_TEST 指定 Agent，會消耗該 Agent 的推論用量")
	}
	def, err := definition(id)
	if err != nil {
		t.Fatal(err)
	}
	path, err := localACPPath(def)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client, err := openAdapter(ctx, def, path)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	models, err := client.Models(ctx)
	if err != nil || len(models) == 0 {
		t.Fatalf("模型查詢失敗：%v", err)
	}
	model := models[len(models)-1].ID
	text, err := client.Analyze(ctx, model, analysisInstructions+"\n人工測試快照：Pod demo，容器 reason=OOMKilled，exitCode=137，memory limit=256Mi；沒有日誌或歷史用量。請以 100 字內回覆。")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(text) == "" {
		t.Fatal("沒有分析內容")
	}
	t.Logf("%s / %s 完成分析，回傳 %d bytes", def.name, model, len(text))
}

var _ io.WriteCloser = (*wireWriter)(nil)

func localACPPath(def agentDefinition) (string, error) {
	if dir := os.Getenv("TERMIX_AI_TEST_BIN_DIR"); dir != "" {
		return filepath.Join(dir, def.command), nil
	}
	return findExecutable(def.command)
}

func acpConfig(value string) []any {
	return []any{map[string]any{
		"id": "engine-selector", "category": "model", "type": "select", "currentValue": value,
		"options": []any{map[string]any{"group": "test", "name": "Models", "options": []any{
			map[string]string{"value": "model-a", "name": "Model A"},
			map[string]string{"value": "model-b", "name": "Model B", "description": "B description"},
		}}},
	}}
}

func TestACPConfigModelsAndSelectedModel(t *testing.T) {
	p, w := fakeProcess(func(m wireMessage, out chan wireMessage) {
		var result any
		switch m.text("method") {
		case "initialize":
			result = map[string]any{"protocolVersion": 1}
		case "session/new":
			result = map[string]any{"sessionId": "s1", "configOptions": acpConfig("model-a"), "models": map[string]any{"availableModels": []any{map[string]string{"modelId": "legacy-ignored"}}}}
		case "session/set_config_option":
			result = map[string]any{"configOptions": acpConfig(m.object("params").text("value"))}
		case "session/prompt":
			for _, chunk := range []struct{ session, kind, text string }{{"other", "agent_message_chunk", "錯誤工作階段"}, {"s1", "agent_thought_chunk", "不呈現推理"}, {"s1", "agent_message_chunk", "## 根因分析\n"}, {"s1", "agent_message_chunk", "OOMKilled"}} {
				out <- message(map[string]any{"method": "session/update", "params": map[string]any{"sessionId": chunk.session, "update": map[string]any{"sessionUpdate": chunk.kind, "content": map[string]string{"type": "text", "text": chunk.text}}}})
			}
			result = map[string]string{"stopReason": "end_turn"}
		}
		out <- message(map[string]any{"id": m["id"], "result": result})
	})
	client, err := initializeACP(context.Background(), p, nil)
	if err != nil {
		t.Fatal(err)
	}
	models, _ := client.Models(context.Background())
	if diff := cmp.Diff([]dto.AIModel{{ID: "model-a", Name: "Model A"}, {ID: "model-b", Name: "Model B", Description: "B description"}}, models); diff != "" {
		t.Fatal(diff)
	}
	text, err := client.Analyze(context.Background(), "model-b", "pod snapshot")
	if err != nil || text != "## 根因分析\nOOMKilled" {
		t.Fatalf("%q, %v", text, err)
	}
	selection := w.messages[2]
	if selection.text("method") != "session/set_config_option" || selection.object("params").text("configId") != "engine-selector" || selection.object("params").text("value") != "model-b" {
		t.Fatal("未使用 Agent 提供的模型選項 ID 與選取值")
	}
	caps := w.messages[0].object("params").object("clientCapabilities")
	if string(caps["terminal"]) != "false" || string(caps.object("fs")["readTextFile"]) != "false" {
		t.Fatal("不應提供工具能力")
	}
}

func TestACPLegacyModelsAndIncompleteResults(t *testing.T) {
	for _, stop := range []string{"end_turn", "max_tokens", "cancelled", "refusal", ""} {
		t.Run(stop, func(t *testing.T) {
			p, w := fakeProcess(func(m wireMessage, out chan wireMessage) {
				result := map[string]any{}
				switch m.text("method") {
				case "initialize":
					result["protocolVersion"] = 1
				case "session/new":
					result = map[string]any{"sessionId": "s", "models": map[string]any{"availableModels": []any{map[string]string{"modelId": "dynamic", "name": "Dynamic"}}}}
				case "session/prompt":
					out <- message(map[string]any{"method": "session/update", "params": map[string]any{"sessionId": "s", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "分析"}}}})
					result["stopReason"] = stop
				}
				out <- message(map[string]any{"id": m["id"], "result": result})
			})
			client, err := initializeACP(context.Background(), p, nil)
			if err != nil {
				t.Fatal(err)
			}
			text, err := client.Analyze(context.Background(), "dynamic", "pod")
			if (err == nil) != (stop == "end_turn") {
				t.Fatalf("stop=%q, text=%q, err=%v", stop, text, err)
			}
			if w.messages[2].text("method") != "session/set_model" || w.messages[2].object("params").text("modelId") != "dynamic" {
				t.Fatal("舊模型協定未選取正確模型")
			}
		})
	}
}

func TestACPRejectsInvalidHandshakeAndMissingModels(t *testing.T) {
	cases := []struct {
		name    string
		version any
		session any
	}{
		{"version", 2, nil}, {"missing-version", nil, nil},
		{"missing-session", 1, map[string]any{"configOptions": acpConfig("model-a")}},
		{"missing-models", 1, map[string]any{"sessionId": "s"}},
		{"malformed-config", 1, map[string]any{"sessionId": "s", "configOptions": "invalid"}},
		{"empty-models", 1, map[string]any{"sessionId": "s", "models": map[string]any{"availableModels": []any{}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, _ := fakeProcess(func(m wireMessage, out chan wireMessage) {
				result := tc.session
				if m.text("method") == "initialize" {
					result = map[string]any{"protocolVersion": tc.version}
				}
				out <- message(map[string]any{"id": m["id"], "result": result})
			})
			if _, err := initializeACP(context.Background(), p, nil); err == nil {
				t.Fatal("無效 ACP 回應不得成功")
			}
		})
	}
}

func TestACPDoesNotPromptWhenModelIsUnconfirmed(t *testing.T) {
	p, w := fakeProcess(func(m wireMessage, out chan wireMessage) {
		out <- message(map[string]any{"id": m["id"], "result": map[string]any{"configOptions": acpConfig("model-a")}})
	})
	client := &acpAdapter{process: p, sessionID: "s", modelConfigID: "engine-selector", models: []dto.AIModel{{ID: "model-b"}}}
	if _, err := client.Analyze(context.Background(), "model-b", "sensitive pod data"); err == nil {
		t.Fatal("不得默默使用其他模型")
	}
	if len(w.messages) != 1 || w.messages[0].text("method") != "session/set_config_option" {
		t.Fatal("不應送出分析資料")
	}
	if _, err := client.Analyze(context.Background(), "unknown", "sensitive pod data"); err == nil || len(w.messages) != 1 {
		t.Fatal("未知模型不得送出請求")
	}
}

func TestACPStopsOnToolsOrOversizedOutput(t *testing.T) {
	for _, kind := range []string{"tool_call", "tool_call_update", "agent_message_chunk"} {
		t.Run(kind, func(t *testing.T) {
			p, _ := fakeProcess(func(m wireMessage, out chan wireMessage) {
				if m.text("method") == "session/prompt" {
					out <- message(map[string]any{"method": "session/update", "params": map[string]any{"sessionId": "s", "update": map[string]any{"sessionUpdate": kind, "content": map[string]string{"type": "text", "text": strings.Repeat("a", maxAgentOutput+1)}}}})
				}
				out <- message(map[string]any{"id": m["id"], "result": map[string]any{}})
			})
			client := &acpAdapter{process: p, sessionID: "s", models: []dto.AIModel{{ID: "m"}}}
			if _, err := client.Analyze(context.Background(), "m", "pod"); err == nil {
				t.Fatal("應停止分析")
			}
		})
	}
}

func TestACPRejectsReverseRequestsAndSendsCancellation(t *testing.T) {
	p, w := fakeProcess(func(m wireMessage, out chan wireMessage) {
		if m.text("method") == "test" {
			for i, method := range []string{"session/request_permission", "fs/read_text_file", "terminal/create"} {
				out <- message(map[string]any{"id": 99 + i, "method": method, "params": map[string]any{}})
			}
			out <- message(map[string]any{"id": m["id"], "result": map[string]any{}})
		}
	})
	if _, err := p.rpc(context.Background(), "test", nil, nil); err != nil {
		t.Fatal(err)
	}
	if w.messages[1].object("result").object("outcome").text("outcome") != "cancelled" {
		t.Fatal("未依 ACP 拒絕權限請求")
	}
	for _, m := range w.messages[2:4] {
		if len(m["error"]) == 0 {
			t.Fatal("不得提供檔案與終端機")
		}
	}
	p.setCancelSession("owned-session")
	p.sendCancellation()
	cancelMessage := w.messages[4]
	if cancelMessage.text("method") != "session/cancel" || cancelMessage.object("params").text("sessionId") != "owned-session" || len(cancelMessage["id"]) != 0 {
		t.Fatal("取消應是指定工作階段的 ACP notification")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.next(ctx); err != context.Canceled {
		t.Fatal(err)
	}
}

func TestACPErrorWithNoMessageStillFails(t *testing.T) {
	p, _ := fakeProcess(func(m wireMessage, out chan wireMessage) {
		out <- message(map[string]any{"id": m["id"], "error": map[string]any{"code": -32000}})
	})
	if _, err := p.rpc(context.Background(), "session/new", nil, nil); err == nil {
		t.Fatal("錯誤回覆不得視為成功")
	}
}

func TestCodexACPDisablesConfiguredMCPAndTools(t *testing.T) {
	data, err := codexAnalysisConfig([]byte(`[{"name":"ordinary"},{"name":"name.with.dots"}]`))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"features.shell_tool", "features.plugins", "features.hooks"} {
		if config[key] != false {
			t.Fatalf("未停用 %s", key)
		}
	}
	mcp := config["mcp_servers"].(map[string]any)
	for _, name := range []string{"ordinary", "name.with.dots"} {
		if mcp[name].(map[string]any)["enabled"] != false {
			t.Fatalf("未停用 MCP %s", name)
		}
	}
	for _, invalid := range []string{"null", `{}`, `[{"name":""}]`} {
		if _, err := codexAnalysisConfig([]byte(invalid)); err == nil {
			t.Fatal("不完整設定不得啟動")
		}
	}
}
