package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"strings"

	"gopkg.in/yaml.v3"
)

type ContextSummary struct {
	Context   string     `json:"context"`
	Cluster   string     `json:"cluster"`
	Namespace string     `json:"namespace"`
	EKS       *EKSConfig `json:"eks,omitempty"`
	Issue     string     `json:"issue,omitempty"`
}

func parseConfig(raw string) (kubeconfig, error) {
	var cfg kubeconfig
	invalid := errors.New("config_invalid")
	if len(raw) == 0 || len(raw) > 256*1024 || yaml.Unmarshal([]byte(raw), &cfg) != nil || cfg.Kind != "Config" || len(cfg.Contexts) == 0 || len(cfg.Contexts) > 500 {
		return cfg, invalid
	}
	unique := func(names []string) bool {
		seen := map[string]bool{}
		for _, name := range names {
			if strings.TrimSpace(name) == "" || len(name) > 1024 || strings.ContainsAny(name, "\x00\r\n") || seen[name] {
				return false
			}
			seen[name] = true
		}
		return true
	}
	names := []string{}
	for _, item := range cfg.Contexts {
		names = append(names, item.Name)
	}
	if !unique(names) {
		return cfg, invalid
	}
	names = nil
	for _, item := range cfg.Clusters {
		names = append(names, item.Name)
	}
	if !unique(names) {
		return cfg, invalid
	}
	names = nil
	for _, item := range cfg.Users {
		names = append(names, item.Name)
	}
	if !unique(names) {
		return cfg, invalid
	}
	return cfg, nil
}

// InspectContexts 只列出非機密摘要；個別驗證失敗不阻擋其他 context 匯入。
func InspectContexts(raw string) (string, error) {
	cfg, err := parseConfig(raw)
	if err != nil {
		return "", err
	}
	summaries := make([]ContextSummary, 0, len(cfg.Contexts))
	index := 0
	for i, item := range cfg.Contexts {
		if item.Name == cfg.Current {
			index = i
		}
		candidate := cfg
		candidate.Current = item.Name
		summary := ContextSummary{Context: item.Name, Cluster: item.Context.Cluster, Namespace: item.Context.Namespace}
		if summary.Namespace == "" {
			summary.Namespace = "default"
		}
		selected, err := selectParsedConfig(candidate)
		if err != nil {
			summary.Issue = err.Error()
		} else {
			summary.EKS = selected.EKS
		}
		summaries = append(summaries, summary)
	}
	result, err := json.Marshal(struct {
		ContextSummary
		Contexts []ContextSummary `json:"contexts"`
	}{summaries[index], summaries})
	if err != nil {
		return "", errors.New("config_invalid")
	}
	return string(result), nil
}

// SelectContext 僅改 current-context，保留其他叢集、使用者與未支援的設定欄位。
func SelectContext(raw, name string) (string, error) {
	cfg, err := parseConfig(raw)
	if err != nil {
		return "", err
	}
	found := false
	for _, item := range cfg.Contexts {
		if item.Name == name {
			found = true
			break
		}
	}
	if !found {
		return "", errors.New("config_invalid")
	}
	var document yaml.Node
	if yaml.Unmarshal([]byte(raw), &document) != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return "", errors.New("config_invalid")
	}
	root := document.Content[0]
	updated := false
	for i := 0; i < len(root.Content); i += 2 {
		if root.Content[i].Value == "current-context" {
			root.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name}
			updated = true
			break
		}
	}
	if !updated {
		root.Content = append(root.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "current-context"}, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name})
	}
	data, err := yaml.Marshal(&document)
	if err != nil || len(data) > 256*1024 {
		return "", errors.New("config_invalid")
	}
	return string(data), nil
}

// SelectAWSProfile 只覆寫目前 context 的手機 profile，不更動共享 user 或原始 exec。
func SelectAWSProfile(raw, name string) (string, error) {
	cfg, err := selectConfig(raw)
	if err != nil {
		return "", err
	}
	if cfg.EKS == nil || (name != "" && !profilePattern.MatchString(name)) {
		return "", errors.New("aws_profile_invalid")
	}
	var document yaml.Node
	if yaml.Unmarshal([]byte(raw), &document) != nil {
		return "", errors.New("config_invalid")
	}
	root := document.Content[0]
	for i := 0; i < len(root.Content); i += 2 {
		if root.Content[i].Value != "contexts" {
			continue
		}
		for _, item := range root.Content[i+1].Content {
			var contextNode *yaml.Node
			match := false
			for j := 0; j < len(item.Content); j += 2 {
				if item.Content[j].Value == "name" && item.Content[j+1].Value == cfg.ContextName {
					match = true
				}
				if item.Content[j].Value == "context" {
					contextNode = item.Content[j+1]
				}
			}
			if !match {
				continue
			}
			if contextNode == nil || contextNode.Kind != yaml.MappingNode || contextNode.Anchor != "" {
				return "", errors.New("config_invalid")
			}
			// YAML alias 共用節點不接受修改，以免影響其他 context。
			replaced := false
			for j := 0; j < len(contextNode.Content); j += 2 {
				if contextNode.Content[j].Value == "x-termix-aws-profile" {
					contextNode.Content[j+1] = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name}
					replaced = true
					break
				}
			}
			if !replaced {
				contextNode.Content = append(contextNode.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "x-termix-aws-profile"}, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name})
			}
			data, err := yaml.Marshal(&document)
			if err != nil || len(data) > 256*1024 {
				return "", errors.New("config_invalid")
			}
			return string(data), nil
		}
	}
	return "", errors.New("config_invalid")
}
