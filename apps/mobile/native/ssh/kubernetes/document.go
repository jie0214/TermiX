package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"gopkg.in/yaml.v3"
)

const documentLimit = 512 * 1024

type imageField struct {
	Name  string `json:"name"`
	Group string `json:"group"`
	Image string `json:"image"`
}
type resourceDocument struct {
	YAML            string       `json:"yaml"`
	UID             string       `json:"uid"`
	ResourceVersion string       `json:"resourceVersion"`
	Containers      []imageField `json:"containers"`
}
type documentChange struct {
	UID             string      `json:"uid"`
	ResourceVersion string      `json:"resourceVersion"`
	YAML            *string     `json:"yaml,omitempty"`
	Container       *imageField `json:"container,omitempty"`
}

func documentRoute(kind string) (string, string) {
	switch kind {
	case "pods":
		return "api/v1", "Pod"
	case "configmaps":
		return "api/v1", "ConfigMap"
	case "deployments":
		return "apis/apps/v1", "Deployment"
	case "statefulsets":
		return "apis/apps/v1", "StatefulSet"
	}
	return "", ""
}
func object(v any) map[string]any                   { m, _ := v.(map[string]any); return m }
func stringField(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func checkDocument(doc map[string]any, namespace, kind, name string) bool {
	route, expected := documentRoute(kind)
	version := strings.TrimPrefix(route, "apis/")
	version = strings.TrimPrefix(version, "api/")
	meta := object(doc["metadata"])
	return expected != "" && doc["apiVersion"] == version && doc["kind"] == expected && meta["name"] == name && meta["namespace"] == namespace && stringField(meta, "uid") != "" && stringField(meta, "resourceVersion") != ""
}
func containerSpec(doc map[string]any, kind string) map[string]any {
	spec := object(doc["spec"])
	if kind == "deployments" || kind == "statefulsets" {
		return object(object(spec["template"])["spec"])
	}
	if kind == "pods" {
		return spec
	}
	return nil
}
func documentResult(doc map[string]any, kind string) (string, error) {
	// 隱藏伺服器狀態及欄位管理資訊；使用者內容僅存在記憶體。
	delete(doc, "status")
	meta := object(doc["metadata"])
	delete(meta, "managedFields")
	body, err := yaml.Marshal(doc)
	if err != nil || len(body) > documentLimit {
		return "", errors.New("document_too_large")
	}
	out := resourceDocument{YAML: string(body), UID: stringField(meta, "uid"), ResourceVersion: stringField(meta, "resourceVersion"), Containers: []imageField{}}
	spec := containerSpec(doc, kind)
	for _, group := range []string{"containers", "initContainers"} {
		items, _ := spec[group].([]any)
		for _, item := range items {
			c := object(item)
			out.Containers = append(out.Containers, imageField{stringField(c, "name"), group, stringField(c, "image")})
		}
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}
func readDocument(raw, namespace, kind, name string) (map[string]any, error) {
	route, _ := documentRoute(kind)
	if route == "" || !validResourceName(name) {
		return nil, errors.New("invalid_resource")
	}
	b, err := requestAPI(raw, namespace, apiRequest{apiPath: route, resource: kind, name: name, maxBytes: documentLimit})
	if err != nil {
		return nil, err
	}
	if len(b) > documentLimit {
		return nil, errors.New("document_too_large")
	}
	var doc map[string]any
	// YAML 解碼 JSON 保留整數，不經 float64 轉換。
	if yaml.Unmarshal(b, &doc) != nil || !checkDocument(doc, namespace, kind, name) {
		return nil, errors.New("api_failed")
	}
	return doc, nil
}

// GetDocument 只讀取目前支援的具名資源，不接受任意 API 路徑。
func GetDocument(raw, namespace, kind, name string) (string, error) {
	doc, err := readDocument(raw, namespace, kind, name)
	if err != nil {
		return "", err
	}
	return documentResult(doc, kind)
}
func validateNode(n *yaml.Node, depth int) bool {
	if depth > 64 || n.Kind == yaml.AliasNode || n.Anchor != "" {
		return false
	}
	switch n.Tag {
	case "", "!!map", "!!seq", "!!str", "!!int", "!!float", "!!bool", "!!null":
	default:
		return false
	}
	for i, c := range n.Content {
		if n.Kind == yaml.MappingNode && i%2 == 0 && c.Tag != "!!str" {
			return false
		}
		if !validateNode(c, depth+1) {
			return false
		}
	}
	return true
}
func parseDocument(input string) (map[string]any, error) {
	if len(input) > documentLimit {
		return nil, errors.New("document_too_large")
	}
	decoder := yaml.NewDecoder(strings.NewReader(input))
	var node, extra yaml.Node
	if decoder.Decode(&node) != nil || !validateNode(&node, 0) || decoder.Decode(&extra) != io.EOF {
		return nil, errors.New("invalid_yaml")
	}
	var doc map[string]any
	if node.Decode(&doc) != nil || doc == nil {
		return nil, errors.New("invalid_yaml")
	}
	return doc, nil
}

// UpdateDocument 使用原始 UID／resourceVersion，遇衝突不重送，也不建立新資源。
func UpdateDocument(raw, namespace, kind, name, payload string) (string, error) {
	var change documentChange
	if len(payload) > documentLimit*6 || json.Unmarshal([]byte(payload), &change) != nil || change.UID == "" || change.ResourceVersion == "" || (change.YAML == nil) == (change.Container == nil) {
		return "", errors.New("invalid_yaml")
	}
	route, _ := documentRoute(kind)
	if route == "" || !validResourceName(name) {
		return "", errors.New("invalid_resource")
	}
	var doc map[string]any
	var err error
	if change.YAML != nil {
		doc, err = parseDocument(*change.YAML)
		if err != nil {
			return "", err
		}
		if !checkDocument(doc, namespace, kind, name) || stringField(object(doc["metadata"]), "uid") != change.UID || stringField(object(doc["metadata"]), "resourceVersion") != change.ResourceVersion {
			return "", errors.New("document_identity")
		}
	} else {
		c := change.Container
		if (c.Group != "containers" && c.Group != "initContainers") || c.Name == "" || c.Image == "" || len(c.Image) > 2048 || strings.ContainsAny(c.Image, " \t\r\n") || kind == "configmaps" {
			return "", errors.New("invalid_image")
		}
		doc, err = readDocument(raw, namespace, kind, name)
		if err != nil {
			return "", err
		}
		meta := object(doc["metadata"])
		if meta["uid"] != change.UID || meta["resourceVersion"] != change.ResourceVersion {
			return "", errors.New("scale_conflict")
		}
		items, _ := containerSpec(doc, kind)[c.Group].([]any)
		found := false
		for _, item := range items {
			m := object(item)
			if m["name"] == c.Name {
				m["image"] = c.Image
				found = true
			}
		}
		if !found {
			return "", errors.New("invalid_image")
		}
	}
	delete(doc, "status")
	delete(object(doc["metadata"]), "managedFields")
	body, err := json.Marshal(doc)
	if err != nil {
		return "", errors.New("invalid_yaml")
	}
	if len(body) > documentLimit {
		return "", errors.New("document_too_large")
	}
	result, err := requestAPI(raw, namespace, apiRequest{apiPath: route, resource: kind, name: name, method: http.MethodPut, body: body, maxBytes: documentLimit, query: url.Values{"fieldValidation": {"Strict"}}})
	if err != nil {
		if err.Error() == "connection_failed" || err.Error() == "api_failed" {
			return "", errors.New("document_unknown")
		}
		return "", err
	}
	var accepted map[string]any
	if len(result) > documentLimit || yaml.Unmarshal(result, &accepted) != nil || !checkDocument(accepted, namespace, kind, name) || object(accepted["metadata"])["uid"] != change.UID {
		return "", errors.New("document_unknown")
	}
	out, err := documentResult(accepted, kind)
	if err != nil {
		return "", errors.New("document_unknown")
	}
	return out, nil
}
