package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
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
	Detail    string `json:"detail,omitempty"`
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
		MinReplicas    *int `json:"minReplicas"`
		MaxReplicas    int  `json:"maxReplicas"`
		ScaleTargetRef struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"scaleTargetRef"`
		PolicyTypes []string          `json:"policyTypes"`
		Hard        map[string]string `json:"hard"`
		Limits      []struct {
			Type string `json:"type"`
		} `json:"limits"`
		Replicas    *int   `json:"replicas"`
		Type        string `json:"type"`
		ClusterIP   string `json:"clusterIP"`
		Schedule    string `json:"schedule"`
		Suspend     bool   `json:"suspend"`
		Completions *int   `json:"completions"`
		Ports       []struct {
			Port     int    `json:"port"`
			Protocol string `json:"protocol"`
		} `json:"ports"`
		Rules []struct {
			Host string `json:"host"`
		} `json:"rules"`
	} `json:"spec"`
	Status struct {
		CurrentReplicas    int               `json:"currentReplicas"`
		DesiredReplicas    int               `json:"desiredReplicas"`
		CurrentHealthy     int               `json:"currentHealthy"`
		DesiredHealthy     int               `json:"desiredHealthy"`
		DisruptionsAllowed int               `json:"disruptionsAllowed"`
		Hard               map[string]string `json:"hard"`
		Used               map[string]string `json:"used"`
		Phase              string            `json:"phase"`
		Capacity           map[string]string `json:"capacity"`
		Succeeded          int               `json:"succeeded"`
		Failed             int               `json:"failed"`
		Active             json.RawMessage   `json:"active"`
		DesiredScheduled   int               `json:"desiredNumberScheduled"`
		NumberReady        int               `json:"numberReady"`
		ObservedGeneration *int64            `json:"observedGeneration"`
		Available          int               `json:"availableReplicas"`
		Conditions         []healthCondition `json:"conditions"`
		Ready              int               `json:"readyReplicas"`
		Updated            int               `json:"updatedReplicas"`
	} `json:"status"`
	AddressType string `json:"addressType"`
	Endpoints   []struct {
		Addresses  []string `json:"addresses"`
		Conditions struct {
			Ready *bool `json:"ready"`
		} `json:"conditions"`
	} `json:"endpoints"`
	Rules    []json.RawMessage `json:"rules"`
	Subjects []json.RawMessage `json:"subjects"`
	RoleRef  struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	} `json:"roleRef"`
	AutomountServiceAccountToken *bool             `json:"automountServiceAccountToken"`
	ImagePullSecrets             []json.RawMessage `json:"imagePullSecrets"`
	Data                         map[string]string `json:"data"`
	BinaryData                   map[string][]byte `json:"binaryData"`
	Immutable                    bool              `json:"immutable"`
}

// ListResources 使用允許的資源路徑，清單不回傳 ConfigMap 或 Secret 值。
func ListResources(raw, namespace, kind string) (string, error) {
	apiPath, _ := documentRoute(kind)
	if apiPath == "" || kind == "pods" {
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
		if kind == "configmaps" || kind == "secrets" {
			s.KeyCount = len(item.Data) + len(item.BinaryData)
			s.Immutable = item.Immutable
		} else if kind == "deployments" || kind == "statefulsets" || kind == "replicasets" || kind == "daemonsets" {
			if kind == "daemonsets" {
				item.Spec.Replicas = &item.Status.DesiredScheduled
				item.Status.Ready = item.Status.NumberReady
			}
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
		switch kind {
		case "horizontalpodautoscalers":
			minimum := 1
			if item.Spec.MinReplicas != nil {
				minimum = *item.Spec.MinReplicas
			}
			s.Detail = fmt.Sprintf("%s/%s · Replicas %d → %d · Min %d / Max %d", item.Spec.ScaleTargetRef.Kind, item.Spec.ScaleTargetRef.Name, item.Status.CurrentReplicas, item.Status.DesiredReplicas, minimum, item.Spec.MaxReplicas)
		case "poddisruptionbudgets":
			s.Detail = fmt.Sprintf("Healthy %d / Desired %d · Disruptions allowed %d", item.Status.CurrentHealthy, item.Status.DesiredHealthy, item.Status.DisruptionsAllowed)
		case "networkpolicies":
			types := item.Spec.PolicyTypes
			s.Detail = "Policy types: " + strings.Join(types, ", ")
		case "endpointslices":
			ready, unknown := 0, 0
			for _, endpoint := range item.Endpoints {
				if endpoint.Conditions.Ready == nil {
					unknown++
				} else if *endpoint.Conditions.Ready {
					ready++
				}
			}
			s.Detail = fmt.Sprintf("%s · Endpoints %d · Ready %d · Unknown %d", item.AddressType, len(item.Endpoints), ready, unknown)
		case "serviceaccounts":
			automount := "Default"
			if item.AutomountServiceAccountToken != nil {
				automount = fmt.Sprint(*item.AutomountServiceAccountToken)
			}
			s.Detail = fmt.Sprintf("Token automount %s · Image pull secrets %d", automount, len(item.ImagePullSecrets))
		case "roles":
			s.Detail = fmt.Sprintf("Rules %d", len(item.Rules))
		case "rolebindings":
			s.Detail = fmt.Sprintf("%s/%s · Subjects %d", item.RoleRef.Kind, item.RoleRef.Name, len(item.Subjects))
		case "resourcequotas":
			hard := item.Status.Hard
			if len(hard) == 0 {
				hard = item.Spec.Hard
			}
			keys := make([]string, 0, len(hard))
			for key := range hard {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			values := []string{}
			for _, key := range keys {
				used := item.Status.Used[key]
				if used == "" {
					used = "Unknown"
				}
				values = append(values, key+" "+used+" / "+hard[key])
			}
			s.Detail = strings.Join(values, " · ")
		case "limitranges":
			types := []string{}
			for _, limit := range item.Spec.Limits {
				types = append(types, limit.Type)
			}
			s.Detail = "Limits: " + strings.Join(types, ", ")
		case "services":
			ports := []string{}
			for _, p := range item.Spec.Ports {
				ports = append(ports, fmt.Sprintf("%d/%s", p.Port, p.Protocol))
			}
			s.Detail = strings.Join([]string{item.Spec.Type, item.Spec.ClusterIP, strings.Join(ports, ", ")}, " · ")
		case "ingresses":
			hosts := []string{}
			for _, r := range item.Spec.Rules {
				hosts = append(hosts, r.Host)
			}
			s.Detail = strings.Join(hosts, ", ")
		case "persistentvolumeclaims":
			s.Detail = item.Status.Phase + " · " + item.Status.Capacity["storage"]
		case "cronjobs":
			s.Detail = item.Spec.Schedule
			if item.Spec.Suspend {
				s.Detail += " · Suspended"
			}
		case "jobs":
			var active int
			if len(item.Status.Active) > 0 && json.Unmarshal(item.Status.Active, &active) != nil {
				return "", errors.New("api_failed")
			}
			s.Detail = fmt.Sprintf("Active %d · Succeeded %d · Failed %d", active, item.Status.Succeeded, item.Status.Failed)
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
