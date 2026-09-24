package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"regexp"
	"sort"
)

var configKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

var resourceNamePattern = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)

func validResourceName(name string) bool {
	return len(name) > 0 && len(name) <= 253 && resourceNamePattern.MatchString(name)
}

type resourceMetadata struct {
	Generation        int64   `json:"generation"`
	DeletionTimestamp *string `json:"deletionTimestamp"`
	Name              string  `json:"name"`
	Namespace         string  `json:"namespace"`
}
type resourceSummary struct {
	Health    string `json:"health,omitempty"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Ready     int    `json:"ready"`
	Desired   int    `json:"desired"`
	Updated   int    `json:"updated"`
	KeyCount  int    `json:"keyCount"`
	Immutable bool   `json:"immutable"`
}
type resourceItem struct {
	Metadata resourceMetadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status struct {
		ObservedGeneration *int64            `json:"observedGeneration"`
		Available          int               `json:"availableReplicas"`
		Conditions         []healthCondition `json:"conditions"`
		Ready              int               `json:"readyReplicas"`
		Updated            int               `json:"updatedReplicas"`
	} `json:"status"`
	Data       map[string]string `json:"data"`
	BinaryData map[string][]byte `json:"binaryData"`
	Immutable  bool              `json:"immutable"`
}

// ListResources 只允許本票支援的唯讀資源，不回傳 ConfigMap 值。
func ListResources(raw, namespace, kind string) (string, error) {
	apiPath := "apis/apps/v1"
	switch kind {
	case "deployments", "statefulsets":
	case "configmaps":
		apiPath = "api/v1"
	default:
		return "", errors.New("invalid_resource")
	}
	body, err := getResource(raw, namespace, apiPath, kind, "")
	if err != nil {
		return "", err
	}
	var list struct {
		Metadata struct {
			Continue string `json:"continue"`
		} `json:"metadata"`
		Items []resourceItem `json:"items"`
	}
	if err = json.Unmarshal(body, &list); err != nil || list.Items == nil || len(list.Items) > 200 {
		return "", errors.New("api_failed")
	}
	result := struct {
		Items   []resourceSummary `json:"items"`
		HasMore bool              `json:"hasMore"`
	}{Items: make([]resourceSummary, 0, len(list.Items)), HasMore: list.Metadata.Continue != ""}
	for _, item := range list.Items {
		if !validResourceName(item.Metadata.Name) || item.Metadata.Namespace != namespace {
			return "", errors.New("api_failed")
		}
		s := resourceSummary{Name: item.Metadata.Name, Namespace: namespace}
		if kind == "configmaps" {
			s.KeyCount = len(item.Data) + len(item.BinaryData)
			s.Immutable = item.Immutable
		} else {
			s.Desired = 1
			if item.Spec.Replicas != nil {
				s.Desired = *item.Spec.Replicas
			}
			s.Health = workloadHealth(item, kind, s.Desired)
			s.Ready = item.Status.Ready
			s.Updated = item.Status.Updated
			if s.Desired < 0 || s.Ready < 0 || s.Updated < 0 {
				return "", errors.New("api_failed")
			}
		}
		result.Items = append(result.Items, s)
	}
	data, _ := json.Marshal(result)
	return string(data), nil
}

// GetConfigMap 回傳短文字預覽；二進位資料僅回傳大小，內容不落地。
func GetConfigMap(raw, namespace, name string) (string, error) {
	if !validResourceName(name) {
		return "", errors.New("invalid_resource")
	}
	body, err := getResource(raw, namespace, "api/v1", "configmaps", name)
	if err != nil {
		return "", err
	}
	var item resourceItem
	if err = json.Unmarshal(body, &item); err != nil || item.Metadata.Name != name || item.Metadata.Namespace != namespace {
		return "", errors.New("api_failed")
	}
	type entry struct {
		Key       string `json:"key"`
		Value     string `json:"value"`
		Binary    bool   `json:"binary"`
		Bytes     int    `json:"bytes"`
		Truncated bool   `json:"truncated"`
	}
	result := struct {
		Name      string  `json:"name"`
		Namespace string  `json:"namespace"`
		Immutable bool    `json:"immutable"`
		Entries   []entry `json:"entries"`
		Truncated bool    `json:"truncated"`
	}{Name: name, Namespace: namespace, Immutable: item.Immutable, Entries: []entry{}}
	keys := make([]string, 0, len(item.Data)+len(item.BinaryData))
	for key := range item.Data {
		keys = append(keys, key)
	}
	for key := range item.BinaryData {
		if _, exists := item.Data[key]; exists {
			return "", errors.New("api_failed")
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	remaining := 32768
	for i, key := range keys {
		if i >= 200 || remaining <= 0 {
			result.Truncated = true
			break
		}
		if len(key) == 0 || len(key) > 253 || !configKeyPattern.MatchString(key) {
			return "", errors.New("api_failed")
		}
		e := entry{Key: key}
		if binary, ok := item.BinaryData[key]; ok {
			e.Binary = true
			e.Bytes = len(binary)
		} else {
			value := item.Data[key]
			runes := []rune(value)
			limit := min(4096, remaining)
			e.Bytes = len(value)
			if len(runes) > limit {
				e.Truncated = true
				result.Truncated = true
				runes = runes[:limit]
			}
			e.Value = string(runes)
			remaining -= len(runes)
		}
		result.Entries = append(result.Entries, e)
	}
	data, _ := json.Marshal(result)
	return string(data), nil
}
