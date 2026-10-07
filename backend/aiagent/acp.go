package aiagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jie0214/TermiX/shared/dto"
)

func openAdapter(ctx context.Context, def agentDefinition, path string) (adapter, error) {
	p, err := startProcess(ctx, def, path, def.args, func(dir string) ([]string, error) {
		if def.prepare == nil {
			return nil, nil
		}
		return def.prepare(ctx, def, path, dir)
	})
	if err != nil {
		return nil, err
	}
	client, err := initializeACP(ctx, p, def.sessionMeta)
	if err != nil {
		p.Close()
		return nil, fmt.Errorf("%s ACP：%w", def.name, err)
	}
	return client, nil
}

// acpAdapter 不依產品 ID 分支，統一實作 ACP v1 的工作階段與模型選取。
type acpAdapter struct {
	*process
	sessionID     string
	modelConfigID string
	models        []dto.AIModel
}

func initializeACP(ctx context.Context, p *process, meta map[string]any) (*acpAdapter, error) {
	response, err := p.rpc(ctx, "initialize", map[string]any{
		"protocolVersion":    1,
		"clientCapabilities": map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false},
		"clientInfo":         map[string]string{"name": "TermiX", "version": "1.0"},
	}, nil)
	if err != nil {
		return nil, err
	}
	var version int
	if json.Unmarshal(response["protocolVersion"], &version) != nil || version != 1 {
		return nil, errors.New("Agent 的 ACP 協定版本不相容，TermiX 目前支援 ACP v1")
	}
	params := map[string]any{"cwd": p.dir, "mcpServers": []any{}}
	if len(meta) > 0 {
		params["_meta"] = meta
	}
	response, err = p.rpc(ctx, "session/new", params, nil)
	if err != nil {
		return nil, fmt.Errorf("無法建立工作階段，請確認 Agent 登入狀態：%w", err)
	}
	client := &acpAdapter{process: p, sessionID: response.text("sessionId")}
	if strings.TrimSpace(client.sessionID) == "" {
		return nil, errors.New("ACP Agent 未提供工作階段識別碼")
	}
	p.setCancelSession(client.sessionID)
	if err := client.readModels(response); err != nil {
		return nil, err
	}
	return client, nil
}

func (c *acpAdapter) readModels(response wireMessage) error {
	var options []wireMessage
	if raw := response["configOptions"]; len(raw) > 0 && json.Unmarshal(raw, &options) != nil {
		return errors.New("ACP configOptions 格式無效")
	}
	for _, option := range options {
		if option.text("category") != "model" && !(option.text("category") == "" && option.text("id") == "model") {
			continue
		}
		if c.modelConfigID != "" {
			return errors.New("ACP Agent 提供多個模型選項，無法確定模型選取方式")
		}
		if option.text("type") != "select" || option.text("id") == "" {
			return errors.New("ACP Agent 的模型選項不支援選單")
		}
		c.modelConfigID = option.text("id")
		models, err := configModels(option["options"])
		if err != nil {
			return err
		}
		c.models = models
	}
	if c.modelConfigID == "" {
		// 舊版 ACP 的模型擴充仍有 Agent 使用；只在未提供模型 configOption 時相容。
		var models []struct {
			ID          string `json:"modelId"`
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.Unmarshal(response.object("models")["availableModels"], &models); err != nil {
			return errors.New("ACP Agent 未提供動態模型清單，請更新 Agent 或 ACP 轉接程式")
		}
		for _, model := range models {
			c.models = append(c.models, dto.AIModel{ID: model.ID, Name: model.Name, Description: model.Description})
		}
	}
	var err error
	c.models, err = normalizeModels(c.models)
	return err
}

func configModels(raw json.RawMessage) ([]dto.AIModel, error) {
	var options []wireMessage
	if len(raw) == 0 || json.Unmarshal(raw, &options) != nil {
		return nil, errors.New("ACP 模型選項格式無效")
	}
	models := []dto.AIModel{}
	for _, option := range options {
		if grouped := option["options"]; len(grouped) > 0 {
			var group []wireMessage
			if json.Unmarshal(grouped, &group) != nil {
				return nil, errors.New("ACP 模型分組格式無效")
			}
			for _, item := range group {
				if item.text("value") == "" {
					return nil, errors.New("ACP 模型識別碼無效")
				}
				models = append(models, dto.AIModel{ID: item.text("value"), Name: item.text("name"), Description: item.text("description")})
			}
		} else {
			if option.text("value") == "" {
				return nil, errors.New("ACP 模型識別碼無效")
			}
			models = append(models, dto.AIModel{ID: option.text("value"), Name: option.text("name"), Description: option.text("description")})
		}
	}
	return models, nil
}

func (c *acpAdapter) Models(context.Context) ([]dto.AIModel, error) { return c.models, nil }

func (c *acpAdapter) Analyze(ctx context.Context, model, prompt string) (string, error) {
	if err := c.selectModel(ctx, model); err != nil {
		return "", err
	}
	var output strings.Builder
	result, err := c.rpc(ctx, "session/prompt", map[string]any{
		"sessionId": c.sessionID,
		"prompt":    []any{map[string]any{"type": "text", "text": prompt}},
	}, func(m wireMessage) error {
		params := m.object("params")
		if m.text("method") != "session/update" || params.text("sessionId") != c.sessionID {
			return nil
		}
		update := params.object("update")
		if update.text("sessionUpdate") == "tool_call" || update.text("sessionUpdate") == "tool_call_update" {
			return errors.New("ACP Agent 嘗試使用工具，已中止唯讀分析")
		}
		if update.text("sessionUpdate") == "agent_message_chunk" && update.object("content").text("type") == "text" {
			text := update.object("content").text("text")
			if output.Len()+len(text) > maxAgentOutput {
				return errors.New("分析結果超過大小限制")
			}
			output.WriteString(text)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if result.text("stopReason") != "end_turn" {
		return "", fmt.Errorf("ACP 分析未完成：%s", boundedText(result.text("stopReason"), 100))
	}
	if strings.TrimSpace(output.String()) == "" {
		return "", errors.New("ACP Agent 未回傳分析內容")
	}
	return output.String(), nil
}

func (c *acpAdapter) selectModel(ctx context.Context, model string) error {
	valid := false
	for _, item := range c.models {
		if item.ID == model {
			valid = true
			break
		}
	}
	if !valid {
		return errors.New("所選模型不在 ACP Agent 的清單中")
	}
	if c.modelConfigID == "" {
		_, err := c.rpc(ctx, "session/set_model", map[string]any{"sessionId": c.sessionID, "modelId": model}, nil)
		return err
	}
	response, err := c.rpc(ctx, "session/set_config_option", map[string]any{"sessionId": c.sessionID, "configId": c.modelConfigID, "value": model}, nil)
	if err != nil {
		return err
	}
	var options []wireMessage
	if json.Unmarshal(response["configOptions"], &options) != nil {
		return errors.New("ACP Agent 未確認模型設定")
	}
	for _, option := range options {
		if option.text("id") == c.modelConfigID && option.text("currentValue") == model {
			return nil
		}
	}
	return errors.New("ACP Agent 未套用所選模型，未送出分析資料")
}
