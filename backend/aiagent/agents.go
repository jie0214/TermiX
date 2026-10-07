package aiagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// 產品登錄只描述偵測與啟動限制；模型、對話與取消均由共用 ACP client 處理。
// 新增相容 ACP 的產品時，新增登錄與經確認的限制設定即可，不必新增通訊 adapter。
type agentDefinition struct {
	id, name, command, detectCommand, nodeEntry, installHint string
	args                                                     []string
	sessionMeta                                              map[string]any
	prepare                                                  func(context.Context, agentDefinition, string, string) ([]string, error)
}

var agents = []agentDefinition{
	{
		id: "codex", name: "Codex", command: "codex-acp", detectCommand: "codex",
		nodeEntry:   "@agentclientprotocol/codex-acp/dist/index.js",
		installHint: "npm install -g @agentclientprotocol/codex-acp",
		prepare:     prepareCodexACP,
	},
	{
		id: "claude", name: "Claude Code", command: "claude-agent-acp", detectCommand: "claude",
		nodeEntry:   "@agentclientprotocol/claude-agent-acp/dist/index.js",
		installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
		prepare: func(context.Context, agentDefinition, string, string) ([]string, error) {
			return []string{"CLAUDE_CODE_SAFE_MODE=1"}, nil
		},
		// ACP 保留 _meta 擴充欄位；此處僅設定 SDK 的工具與持久化限制。
		sessionMeta: map[string]any{"claudeCode": map[string]any{"options": map[string]any{
			"tools": []string{}, "mcpServers": map[string]any{}, "strictMcpConfig": true,
			"settingSources": []string{"user"}, "settings": map[string]any{"disableAllHooks": true},
			"persistSession": false, "allowDangerouslySkipPermissions": false,
			"extraArgs": map[string]any{"disable-slash-commands": nil},
		}}},
	},
	{
		id: "gemini", name: "Gemini CLI", command: "gemini",
		nodeEntry: "@google/gemini-cli/dist/index.js", args: []string{"--acp", "--extensions", "none"},
		prepare: func(_ context.Context, _ agentDefinition, _, dir string) ([]string, error) {
			settings := filepath.Join(dir, "agent-settings.json")
			data := []byte(`{"tools":{"core":[]},"mcp":{"allowed":["__termix_no_mcp__"]},"hooksConfig":{"enabled":false},"telemetry":{"enabled":false,"logPrompts":false},"general":{"enableAutoUpdate":false}}`)
			if err := os.WriteFile(settings, data, 0600); err != nil {
				return nil, err
			}
			return []string{"GEMINI_CLI_SYSTEM_SETTINGS_PATH=" + settings}, nil
		},
	},
}

func prepareCodexACP(ctx context.Context, def agentDefinition, path, dir string) ([]string, error) {
	// 空 MCP map 不會清除分層設定；用同一 bridge 的 CLI 列出有效設定並逐項停用。
	// 只解析名稱，不將設定或憑證寫入日誌、前端或暫存檔。
	data, err := runAgentCommand(ctx, def, path, dir, []string{"cli", "mcp", "list", "--json"})
	if err != nil {
		return nil, fmt.Errorf("無法確認 Codex ACP 的 MCP 限制，請更新 codex-acp：%w", err)
	}
	config, err := codexAnalysisConfig(data)
	if err != nil {
		return nil, err
	}
	return []string{"CODEX_CONFIG=" + string(config), "INITIAL_AGENT_MODE=read-only", "APP_SERVER_LOGS="}, nil
}

func codexAnalysisConfig(data []byte) ([]byte, error) {
	var servers []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &servers); err != nil || servers == nil {
		return nil, errors.New("Codex ACP 無法提供 MCP 設定，未啟動分析")
	}
	config := map[string]any{"sandbox_mode": "read-only", "approval_policy": "never", "web_search": "disabled", "history.persistence": "none"}
	for _, feature := range []string{"shell_tool", "unified_exec", "multi_agent", "multi_agent_v2", "apps", "plugins", "hooks", "code_mode", "code_mode_host", "in_app_browser", "skill_mcp_dependency_install"} {
		config["features."+feature] = false
	}
	mcp := map[string]any{}
	for _, server := range servers {
		if server.Name == "" {
			return nil, errors.New("Codex ACP 回傳無效 MCP 名稱，未啟動分析")
		}
		// ACP bridge 以整個 server 物件覆寫設定，需保留有效 transport 結構。
		// 使用停用的固定入口，不複製原設定內的憑證、URL 或指令。
		mcp[server.Name] = map[string]any{"enabled": false, "command": "__termix_disabled_mcp__"}
	}
	config["mcp_servers"] = mcp
	return json.Marshal(config)
}
