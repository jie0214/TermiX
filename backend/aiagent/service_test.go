package aiagent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/jie0214/TermiX/shared/dto"
)

type memorySettings struct {
	mu   sync.Mutex
	data dto.AppSettings
}

func (r *memorySettings) LoadSettings(context.Context) (dto.AppSettings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := dto.AppSettings{}
	for k, v := range r.data {
		out[k] = append(json.RawMessage{}, v...)
	}
	return out, nil
}
func (r *memorySettings) SaveSettings(_ context.Context, s dto.AppSettings) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, v := range s {
		r.data[k] = v
	}
	return nil
}

type fakeAdapter struct {
	models  []dto.AIModel
	err     error
	analyze func(context.Context, string, string) (string, error)
	closed  bool
}

func (a *fakeAdapter) Models(context.Context) ([]dto.AIModel, error) { return a.models, a.err }
func (a *fakeAdapter) Analyze(ctx context.Context, m, p string) (string, error) {
	return a.analyze(ctx, m, p)
}
func (a *fakeAdapter) Close() { a.closed = true }
func serviceFixture(client *fakeAdapter) *Service {
	return &Service{repo: &memorySettings{data: dto.AppSettings{connectionSetting: json.RawMessage(`{"codex":true}`), "other": json.RawMessage(`"preserved"`)}}, active: map[string]runningAnalysis{}, find: func(string) (string, error) { return "/bin/agent", nil }, open: func(context.Context, agentDefinition, string) (adapter, error) { return client, nil }}
}

func TestConnectionPersistenceDoesNotStoreModelsCredentialsOrPaths(t *testing.T) {
	client := &fakeAdapter{models: []dto.AIModel{{ID: "actual-model"}}}
	s := serviceFixture(client)
	if err := s.SetConnected(context.Background(), "claude", true); err != nil {
		t.Fatal(err)
	}
	settings, _ := s.repo.LoadSettings(context.Background())
	if string(settings["other"]) != `"preserved"` {
		t.Fatal("覆蓋其他設定")
	}
	if diff := cmp.Diff(`{"claude":true,"codex":true}`, string(settings[connectionSetting])); diff != "" {
		t.Fatal(diff)
	}
	if !client.closed {
		t.Fatal("查詢後未關閉 Agent")
	}
	if err := s.SetConnected(context.Background(), "arbitrary-command", true); err == nil {
		t.Fatal("不接受任意指令")
	}
}

func TestFailedConnectionIsNotSaved(t *testing.T) {
	s := serviceFixture(&fakeAdapter{err: errors.New("not authenticated")})
	if err := s.SetConnected(context.Background(), "claude", true); err == nil {
		t.Fatal("連線應失敗")
	}
	enabled, _ := s.enabled(context.Background())
	if enabled["claude"] {
		t.Fatal("連線失敗仍持久化")
	}
}

func TestCancelBeforeAnalysisRegistration(t *testing.T) {
	s := serviceFixture(&fakeAdapter{models: []dto.AIModel{{ID: "model"}}})
	s.Cancel("early")
	collected := false
	_, err := s.Analyze(context.Background(), dto.PodAnalysisRequest{RequestID: "early", AgentID: "codex", ModelID: "model"}, func(context.Context) (dto.PodAnalysisSnapshot, error) {
		collected = true
		return dto.PodAnalysisSnapshot{}, nil
	})
	if err == nil || collected {
		t.Fatal("先抵達的取消請求未生效")
	}
}

func TestModelValidationPrecedesSensitiveSnapshotCollection(t *testing.T) {
	s := serviceFixture(&fakeAdapter{models: []dto.AIModel{{ID: "agent-reported-model"}}})
	called := false
	_, err := s.Analyze(context.Background(), dto.PodAnalysisRequest{RequestID: "request", AgentID: "codex", ModelID: "made-up"}, func(context.Context) (dto.PodAnalysisSnapshot, error) {
		called = true
		return dto.PodAnalysisSnapshot{}, nil
	})
	if err == nil || called {
		t.Fatal("無效模型不得收集 Pod 資料")
	}
}

func TestCancellationIncludesSnapshotCollection(t *testing.T) {
	s := serviceFixture(&fakeAdapter{models: []dto.AIModel{{ID: "model"}}})
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := s.Analyze(context.Background(), dto.PodAnalysisRequest{RequestID: "request", AgentID: "codex", ModelID: "model"}, func(ctx context.Context) (dto.PodAnalysisSnapshot, error) {
			close(started)
			<-ctx.Done()
			return dto.PodAnalysisSnapshot{}, ctx.Err()
		})
		done <- err
	}()
	<-started
	s.Cancel("request")
	if err := <-done; err == nil {
		t.Fatal("取消應中止收集")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.active) != 0 {
		t.Fatal("取消後仍保留工作")
	}
}

func TestDisconnectCancelsInferenceAndKeepsSnapshotAsData(t *testing.T) {
	started := make(chan struct{})
	done := make(chan error, 1)
	client := &fakeAdapter{models: []dto.AIModel{{ID: "model"}}, analyze: func(ctx context.Context, model, prompt string) (string, error) {
		if model != "model" || !strings.Contains(prompt, "診斷資料") || !strings.Contains(prompt, "evidence") {
			t.Error("缺少模型或資料邊界")
		}
		close(started)
		<-ctx.Done()
		return "", ctx.Err()
	}}
	s := serviceFixture(client)
	go func() {
		_, err := s.Analyze(context.Background(), dto.PodAnalysisRequest{RequestID: "request", AgentID: "codex", ModelID: "model"}, func(context.Context) (dto.PodAnalysisSnapshot, error) { return dto.PodAnalysisSnapshot{}, nil })
		done <- err
	}()
	<-started
	if err := s.SetConnected(context.Background(), "codex", false); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("中斷連線後推論仍成功")
	}
}

func TestMissingACPBridgeKeepsDetectedProductAndExplainsInstallation(t *testing.T) {
	s := serviceFixture(&fakeAdapter{})
	s.find = func(command string) (string, error) {
		if command == "codex" {
			return "/bin/codex", nil
		}
		return "", errors.New("not installed")
	}
	connections, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 1 || connections[0].ID != "codex" || connections[0].Name != "Codex" || connections[0].Path != "/bin/codex" {
		t.Fatal("原生 CLI 應仍可辨識")
	}
	if _, err := s.Test(context.Background(), "codex"); err == nil || !strings.Contains(err.Error(), "@agentclientprotocol/codex-acp") {
		t.Fatal("缺少 bridge 時應提供安裝方式")
	}
}

func TestACPBridgeIsPreferredOverNativeCLI(t *testing.T) {
	s := serviceFixture(&fakeAdapter{})
	s.find = func(command string) (string, error) {
		if command == "codex-acp" {
			return "/bin/codex-acp", nil
		}
		if command == "codex" {
			return "/bin/codex", nil
		}
		return "", errors.New("not installed")
	}
	connections, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(connections) != 1 || connections[0].Path != "/bin/codex-acp" {
		t.Fatal("應優先呈現 ACP 執行檔")
	}
}
