package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"net/url"
	"sort"
)

// ListNamespaces 以固定頁面大小取得叢集層級 namespace，沿用 TLS、驗證與回應大小限制。
func ListNamespaces(raw, cursor string) (string, error) {
	if len(cursor) > 8192 {
		return "", errors.New("api_failed")
	}
	query := url.Values{"limit": {"200"}}
	if cursor != "" {
		query.Set("continue", cursor)
	}
	body, err := requestAPI(raw, "", apiRequest{clusterScoped: true, apiPath: "api/v1", resource: "namespaces", query: query, maxBytes: 2 * 1024 * 1024})
	if err != nil {
		if err.Error() == "forbidden" {
			return "", errors.New("namespaces_forbidden")
		}
		return "", err
	}
	var list struct {
		Metadata struct {
			Continue string `json:"continue"`
		} `json:"metadata"`
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if len(body) > 2*1024*1024 || json.Unmarshal(body, &list) != nil || list.Items == nil || len(list.Items) > 200 || len(list.Metadata.Continue) > 8192 || (cursor != "" && list.Metadata.Continue == cursor) {
		return "", errors.New("api_failed")
	}
	names := []string{}
	seen := map[string]bool{}
	for _, item := range list.Items {
		name := item.Metadata.Name
		if len(name) > 63 || !namespacePattern.MatchString(name) || seen[name] {
			return "", errors.New("api_failed")
		}
		seen[name] = true
		names = append(names, name)
	}
	sort.Strings(names)
	result, _ := json.Marshal(struct {
		Items  []string `json:"items"`
		Cursor string   `json:"cursor"`
	}{names, list.Metadata.Continue})
	return string(result), nil
}
