package snippets

import (
	"path/filepath"
	"github.com/jie0214/TermiX/shared/dto"
	"testing"
	"time"
)

type fakeExecutor struct {
	results map[string]dto.OperationResult
	calls   []fakeExecutorCall
}

type fakeExecutorCall struct {
	host   string
	script string
}

func (f *fakeExecutor) ExecuteSnippet(config dto.SSHConfig, script string) dto.OperationResult {
	f.calls = append(f.calls, fakeExecutorCall{
		host:   config.Host,
		script: script,
	})
	if result, ok := f.results[config.Host]; ok {
		return result
	}
	return dto.OperationResult{Success: true}
}

func TestSnippetCRUDAndHostStartupCleanup(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "snippets.json")
	now := time.Date(2026, 6, 10, 9, 30, 0, 0, time.UTC)
	svc := newServiceForTest(storePath, &fakeExecutor{}, func() time.Time { return now })

	created, err := svc.CreateSnippet(dto.SnippetUpsertRequest{
		Name:        "Bootstrap",
		Description: "啟動環境",
		Script:      "echo bootstrap",
		Package:     "core",
	})
	if err != nil {
		t.Fatalf("CreateSnippet() error = %v", err)
	}
	if created.Name != "Bootstrap" {
		t.Fatalf("CreateSnippet() name = %q", created.Name)
	}

	reloaded := newServiceForTest(storePath, &fakeExecutor{}, func() time.Time { return now.Add(time.Hour) })
	list, err := reloaded.ListSnippets()
	if err != nil {
		t.Fatalf("ListSnippets() error = %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("ListSnippets() len = %d，預期 1", len(list))
	}

	updated, err := reloaded.UpdateSnippet(dto.SnippetUpsertRequest{
		ID:          created.ID,
		Name:        "Bootstrap v2",
		Description: "啟動環境新版",
		Script:      "echo bootstrap-v2",
		Package:     "ops",
	})
	if err != nil {
		t.Fatalf("UpdateSnippet() error = %v", err)
	}
	if updated.Package != "ops" {
		t.Fatalf("UpdateSnippet() package = %q", updated.Package)
	}

	hostConfig := dto.SSHConfig{
		Host:     "10.20.0.1",
		Port:     22,
		Username: "ops",
		AuthMode: "key",
	}
	preference, err := reloaded.SetHostStartupSnippet(dto.HostStartupSnippetRequest{
		SSH:              hostConfig,
		StartupSnippetID: created.ID,
	})
	if err != nil {
		t.Fatalf("SetHostStartupSnippet() error = %v", err)
	}
	if preference.StartupSnippetID != created.ID {
		t.Fatalf("SetHostStartupSnippet() startupSnippetId = %q", preference.StartupSnippetID)
	}

	if err := reloaded.DeleteSnippet(created.ID); err != nil {
		t.Fatalf("DeleteSnippet() error = %v", err)
	}

	postDeleteList, err := reloaded.ListSnippets()
	if err != nil {
		t.Fatalf("ListSnippets() after delete error = %v", err)
	}
	if len(postDeleteList) != 0 {
		t.Fatalf("ListSnippets() after delete len = %d，預期 0", len(postDeleteList))
	}

	postDeletePreference, err := reloaded.GetHostStartupSnippet(hostConfig)
	if err != nil {
		t.Fatalf("GetHostStartupSnippet() error = %v", err)
	}
	if postDeletePreference.StartupSnippetID != "" {
		t.Fatalf("GetHostStartupSnippet() startupSnippetId = %q，預期空值", postDeletePreference.StartupSnippetID)
	}
}

func TestExecuteSnippetBatchAggregatesFailuresWithoutStopping(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "snippets.json")
	exec := &fakeExecutor{
		results: map[string]dto.OperationResult{
			"10.20.0.10": {Success: true, Output: "ok"},
			"10.20.0.11": {Success: false, Output: "partial", Error: "連線中斷"},
		},
	}
	now := time.Date(2026, 6, 10, 11, 0, 0, 0, time.UTC)
	svc := newServiceForTest(storePath, exec, func() time.Time { return now })

	snippet, err := svc.CreateSnippet(dto.SnippetUpsertRequest{
		Name:   "Batch",
		Script: "echo hello",
	})
	if err != nil {
		t.Fatalf("CreateSnippet() error = %v", err)
	}

	result, err := svc.ExecuteSnippetBatch(dto.ExecuteSnippetBatchRequest{
		SnippetID: snippet.ID,
		Targets: []dto.SnippetExecutionTarget{
			{
				SSH: dto.SSHConfig{
					Host:     "10.20.0.10",
					Port:     22,
					Username: "ops",
					AuthMode: "key",
				},
			},
			{
				SSH: dto.SSHConfig{
					Host:     "10.20.0.11",
					Port:     22,
					Username: "ops",
					AuthMode: "key",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteSnippetBatch() error = %v", err)
	}
	if result.Success {
		t.Fatal("ExecuteSnippetBatch() success = true，預期 false")
	}
	if len(result.Results) != 2 {
		t.Fatalf("ExecuteSnippetBatch() results len = %d，預期 2", len(result.Results))
	}
	if result.Results[0].Output != "ok" {
		t.Fatalf("第 1 筆 output = %q", result.Results[0].Output)
	}
	if result.Results[1].Error != "連線中斷" {
		t.Fatalf("第 2 筆 error = %q", result.Results[1].Error)
	}
	if len(exec.calls) != 2 {
		t.Fatalf("executor calls = %d，預期 2", len(exec.calls))
	}
	for _, call := range exec.calls {
		if call.script != "echo hello" {
			t.Fatalf("executor script = %q，預期 echo hello", call.script)
		}
	}
}
