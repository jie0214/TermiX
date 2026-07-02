package controlpanel

import (
	"os"
	"path/filepath"
	"github.com/jie0214/TermiX/shared/dto"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestExecuteLocalCommandRejectsUnsafeShellByDefault(t *testing.T) {
	t.Setenv(unsafeLocalCommandEnv, "")

	result := NewExecutor().ExecuteLocalCommand("echo blocked", nil)
	expected := dto.OperationResult{
		Success: false,
		Error:   "基於安全限制，TermiX 預設只允許 FunctionBox 執行本機 open 指令。若確定需要執行任意本機 shell 指令，請以 TERMIX_ALLOW_UNSAFE_LOCAL_COMMANDS=1 啟動應用程式。",
	}
	if diff := cmp.Diff(expected, result); diff != "" {
		t.Errorf("ExecuteLocalCommand() mismatch (-want +got):\n%s", diff)
	}
}

func TestExecuteLocalCommandRejectsUnexpandedOpenVariable(t *testing.T) {
	result := NewExecutor().ExecuteLocalCommand(`open "rustdesk://$ID"`, map[string]string{
		"ID": "123456789",
	})
	expected := dto.OperationResult{
		Success: false,
		Error:   "本機 open 指令包含未展開的變數，請確認遠端輸出已成功映射到 exportVars。",
	}
	if diff := cmp.Diff(expected, result); diff != "" {
		t.Errorf("ExecuteLocalCommand() mismatch (-want +got):\n%s", diff)
	}
}

func TestExecuteLocalCommandPassesRustdeskURLToOpen(t *testing.T) {
	binDir := t.TempDir()
	outputPath := filepath.Join(t.TempDir(), "open-args.txt")
	openPath := filepath.Join(binDir, "open")
	script := "#!/bin/sh\nprintf '%s' \"$1\" > " + shellQuote(outputPath) + "\n"
	if err := os.WriteFile(openPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	result := NewExecutor().ExecuteLocalCommand(`open "rustdesk://123456789"`, nil)
	if !result.Success {
		t.Fatalf("ExecuteLocalCommand() failed: %s", result.Error)
	}
	got, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "rustdesk://123456789" {
		t.Fatalf("open arg mismatch: got %q", string(got))
	}
}

func TestExecuteLocalCommandRejectsUnsupportedOpenScheme(t *testing.T) {
	result := NewExecutor().ExecuteLocalCommand(`open "file:///tmp/demo"`, nil)
	expected := dto.OperationResult{
		Success: false,
		Error:   "本機 open 指令不允許 URL scheme：file",
	}
	if diff := cmp.Diff(expected, result); diff != "" {
		t.Errorf("ExecuteLocalCommand() mismatch (-want +got):\n%s", diff)
	}
}

func shellQuote(value string) string {
	quoted := "'"
	for _, ch := range value {
		if ch == '\'' {
			quoted += "'\"'\"'"
		} else {
			quoted += string(ch)
		}
	}
	return quoted + "'"
}

func TestExecuteLocalCommandRejectsEmptyCommand(t *testing.T) {
	result := NewExecutor().ExecuteLocalCommand("   ", nil)
	expected := dto.OperationResult{
		Success: false,
		Error:   "本機指令不可空白",
	}
	if diff := cmp.Diff(expected, result); diff != "" {
		t.Errorf("ExecuteLocalCommand() mismatch (-want +got):\n%s", diff)
	}
}

func TestExecuteLocalCommandPassesEnvironment(t *testing.T) {
	t.Setenv(unsafeLocalCommandEnv, "1")

	result := NewExecutor().ExecuteLocalCommand("printf %s \"$TERMIX_TEST_ID\"", map[string]string{
		"TERMIX_TEST_ID": "abc-123",
	})
	expected := dto.OperationResult{
		Success: true,
		Output:  "abc-123",
	}
	if diff := cmp.Diff(expected, result); diff != "" {
		t.Errorf("ExecuteLocalCommand() mismatch (-want +got):\n%s", diff)
	}
}
