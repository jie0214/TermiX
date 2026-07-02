package kubernetes

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"gopkg.in/yaml.v3"
	"github.com/jie0214/TermiX/shared/dto"
)

func loadConfig(path string, allowCreate bool) (*yaml.Node, os.FileMode, error) {
	data, err := os.ReadFile(path)
	mode := os.FileMode(0600)
	if err != nil {
		if !allowCreate || !errors.Is(err, os.ErrNotExist) {
			return nil, mode, fmt.Errorf("讀取 kubeconfig 失敗：%w", err)
		}
		data = []byte("apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\ncurrent-context: \"\"\n")
	} else if info, statErr := os.Stat(path); statErr == nil {
		mode = info.Mode().Perm()
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, mode, fmt.Errorf("解析 kubeconfig YAML 失敗：%w", err)
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, mode, errors.New("kubeconfig 根節點必須是 YAML mapping")
	}
	return doc.Content[0], mode, nil
}

func mappingValue(mapping *yaml.Node, key string) *yaml.Node {
	if mapping == nil || mapping.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1]
		}
	}
	return nil
}

func scalarValue(node *yaml.Node) string {
	if node == nil {
		return ""
	}
	return node.Value
}

func setMappingNode(mapping *yaml.Node, key string, value *yaml.Node) {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content[i+1] = value
			return
		}
	}
	mapping.Content = append(mapping.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, value)
}

func setMappingScalar(mapping *yaml.Node, key, value string) {
	setMappingNode(mapping, key, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value})
}

func deleteMappingKey(mapping *yaml.Node, key string) {
	if mapping == nil || mapping.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content = append(mapping.Content[:i], mapping.Content[i+2:]...)
			return
		}
	}
}

func namedEntries(sequence *yaml.Node) map[string]*yaml.Node {
	result := make(map[string]*yaml.Node)
	if sequence == nil || sequence.Kind != yaml.SequenceNode {
		return result
	}
	for _, entry := range sequence.Content {
		name := scalarValue(mappingValue(entry, "name"))
		value := namedEntryValue(entry)
		if name != "" && value != nil {
			result[name] = value
		}
	}
	return result
}

func namedEntryValue(entry *yaml.Node) *yaml.Node {
	for _, key := range []string{"context", "cluster", "user"} {
		if node := mappingValue(entry, key); node != nil {
			return node
		}
	}
	return nil
}

func namedEntryExists(sequence *yaml.Node, name string) bool {
	if sequence == nil || sequence.Kind != yaml.SequenceNode {
		return false
	}
	for _, entry := range sequence.Content {
		if scalarValue(mappingValue(entry, "name")) == name {
			return true
		}
	}
	return false
}

func ensureSequence(root *yaml.Node, key string) *yaml.Node {
	node := mappingValue(root, key)
	if node == nil || node.Kind != yaml.SequenceNode {
		node = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		setMappingNode(root, key, node)
	}
	return node
}

func upsertNamed(sequence *yaml.Node, name, valueKey string, update func(*yaml.Node)) {
	for _, entry := range sequence.Content {
		if scalarValue(mappingValue(entry, "name")) == name {
			value := mappingValue(entry, valueKey)
			if value == nil {
				value = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
				setMappingNode(entry, valueKey, value)
			}
			update(value)
			return
		}
	}
	value := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	update(value)
	entry := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	setMappingScalar(entry, "name", name)
	setMappingNode(entry, valueKey, value)
	sequence.Content = append(sequence.Content, entry)
}

func upsertCluster(root *yaml.Node, item dto.KubernetesClusterProfile) {
	upsertNamed(ensureSequence(root, "clusters"), item.ClusterName, "cluster", func(node *yaml.Node) {
		setMappingScalar(node, "server", item.Server)
		if item.CertificateAuthority != "" {
			setMappingScalar(node, "certificate-authority", item.CertificateAuthority)
		} else {
			deleteMappingKey(node, "certificate-authority")
		}
		setMappingNode(node, "insecure-skip-tls-verify", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: strconv.FormatBool(item.InsecureSkipTLSVerify)})
	})
}

func upsertContext(root *yaml.Node, item dto.KubernetesClusterProfile) {
	upsertNamed(ensureSequence(root, "contexts"), item.ContextName, "context", func(node *yaml.Node) {
		setMappingScalar(node, "cluster", item.ClusterName)
		setMappingScalar(node, "user", item.UserName)
		if item.Namespace != "" {
			setMappingScalar(node, "namespace", item.Namespace)
		} else {
			deleteMappingKey(node, "namespace")
		}
	})
}

func writeConfigAtomic(path string, root *yaml.Node, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("建立 kubeconfig 目錄失敗：%w", err)
	}
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{root}}
	data, err := yaml.Marshal(doc)
	if err != nil {
		return fmt.Errorf("序列化 kubeconfig 失敗：%w", err)
	}
	if original, readErr := os.ReadFile(path); readErr == nil {
		if err := os.WriteFile(path+".termix.bak", original, mode); err != nil {
			return fmt.Errorf("備份 kubeconfig 失敗：%w", err)
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".termix-kubeconfig-*")
	if err != nil {
		return fmt.Errorf("建立 kubeconfig 暫存檔失敗：%w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return fmt.Errorf("設定 kubeconfig 暫存檔權限失敗：%w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("寫入 kubeconfig 暫存檔失敗：%w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("同步 kubeconfig 暫存檔失敗：%w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("關閉 kubeconfig 暫存檔失敗：%w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("原子置換 kubeconfig 失敗：%w", err)
	}
	return nil
}
