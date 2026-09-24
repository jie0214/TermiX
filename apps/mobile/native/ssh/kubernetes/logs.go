package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
)

type logContainer struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// GetPodContainers 重新讀取 Pod，避免以清單快照猜測多容器名稱。
func GetPodContainers(raw, namespace, name string) (string, error) {
	if !validResourceName(name) {
		return "", errors.New("invalid_resource")
	}
	body, err := getResource(raw, namespace, "api/v1", "pods", name)
	if err != nil {
		return "", err
	}
	type container struct {
		Name string `json:"name"`
	}
	var pod struct {
		Metadata resourceMetadata `json:"metadata"`
		Spec     struct {
			Containers          []container `json:"containers"`
			InitContainers      []container `json:"initContainers"`
			EphemeralContainers []container `json:"ephemeralContainers"`
		} `json:"spec"`
	}
	if err = json.Unmarshal(body, &pod); err != nil || pod.Metadata.Name != name || pod.Metadata.Namespace != namespace {
		return "", errors.New("api_failed")
	}
	result := struct {
		Containers []logContainer `json:"containers"`
	}{Containers: []logContainer{}}
	seen := map[string]bool{}
	groups := []struct {
		kind  string
		items []container
	}{{"regular", pod.Spec.Containers}, {"init", pod.Spec.InitContainers}, {"ephemeral", pod.Spec.EphemeralContainers}}
	for _, group := range groups {
		for _, item := range group.items {
			if len(item.Name) > 63 || !namespacePattern.MatchString(item.Name) || seen[item.Name] {
				return "", errors.New("api_failed")
			}
			seen[item.Name] = true
			result.Containers = append(result.Containers, logContainer{Name: item.Name, Kind: group.kind})
		}
	}
	if len(result.Containers) == 0 || len(result.Containers) > 200 {
		return "", errors.New("api_failed")
	}
	data, _ := json.Marshal(result)
	return string(data), nil
}

const logByteLimit = 64 * 1024

// GetPodLogs 只讀取有上限的快照，不持續串流、不保存或輸出到日誌。
func GetPodLogs(raw, namespace, name, container string, previous bool) (string, error) {
	if !validResourceName(name) || len(container) > 63 || !namespacePattern.MatchString(container) {
		return "", errors.New("invalid_resource")
	}
	query := url.Values{"container": {container}, "previous": {strconv.FormatBool(previous)}, "follow": {"false"}, "tailLines": {"200"}, "limitBytes": {strconv.Itoa(logByteLimit)}, "timestamps": {"true"}}
	body, err := requestAPI(raw, namespace, apiRequest{apiPath: "api/v1", resource: "pods", name: name, subresource: "log", query: query, maxBytes: logByteLimit, log: true})
	if err != nil {
		return "", err
	}
	truncated := len(body) >= logByteLimit
	if len(body) > logByteLimit {
		body = body[:logByteLimit]
	}
	// 以替代字元處理二進位內容及被位元組上限切斷的 UTF-8。
	text := strings.ToValidUTF8(string(body), "�")
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	if len(lines) > 200 {
		text = strings.Join(lines[len(lines)-200:], "\n")
		truncated = true
	}
	data, _ := json.Marshal(struct {
		Text      string `json:"text"`
		Truncated bool   `json:"truncated"`
	}{Text: text, Truncated: truncated})
	return string(data), nil
}
