package mobilekubernetes

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestContextCatalogAndSelection(t *testing.T) {
	raw := config("https://example.com", "", "secret-token")
	raw = strings.Replace(raw, "users:\n", "users:\n- name: unsupported\n  user:\n    exec: {command: arbitrary-command}\n", 1)
	raw += "- name: second\n  context: {cluster: local, user: unsupported, namespace: prod}\nextensions: [{name: preserve, extension: {value: custom}}]\n"
	summary, err := InspectContexts(raw)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Context  string           `json:"context"`
		Contexts []ContextSummary `json:"contexts"`
	}
	if err = json.Unmarshal([]byte(summary), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Contexts) != 2 || result.Context != "lab" || result.Contexts[0].Issue != "" || result.Contexts[1].Issue != "unsupported_eks_exec" || strings.Contains(summary, "secret-token") {
		t.Fatal(summary)
	}
	selected, err := SelectContext(raw, "second")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := parseConfig(selected)
	if err != nil || cfg.Current != "second" || len(cfg.Contexts) != 2 || len(cfg.Users) != 2 {
		t.Fatal("selection lost configuration")
	}
	if !strings.Contains(selected, "secret-token") || !strings.Contains(selected, "arbitrary-command") || !strings.Contains(selected, "custom") {
		t.Fatal("selection removed original fields")
	}
	if _, err = Inspect(selected); err == nil || err.Error() != "unsupported_eks_exec" {
		t.Fatal("unsupported context must fail")
	}
	restored, err := SelectContext(selected, "lab")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Inspect(restored); err != nil {
		t.Fatal(err)
	}
	if _, err = SelectContext(raw, "missing"); err == nil {
		t.Fatal("unknown context accepted")
	}
	fallback := strings.Replace(raw, "current-context: lab\n", "", 1)
	summary, err = InspectContexts(fallback)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal([]byte(summary), &result); err != nil || result.Context != "lab" {
		t.Fatal("missing default not recovered")
	}
	duplicate := strings.Replace(raw, "name: second", "name: lab", 1)
	if _, err = InspectContexts(duplicate); err == nil {
		t.Fatal("duplicate context accepted")
	}
}
