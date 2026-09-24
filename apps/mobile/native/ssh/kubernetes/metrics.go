package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var quantityPattern = regexp.MustCompile(`^(\+?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))([eE][+-]?[0-9]+|[numkMGTPE]|[KMGTPE]i)?$`)

// usageQuantity 只接受有界、非負的 Kubernetes Quantity，不將缺少或非法用量當作零。
func usageQuantity(raw string) (float64, error) {
	if len(raw) == 0 || len(raw) > 64 {
		return 0, errors.New("metrics_invalid")
	}
	parts := quantityPattern.FindStringSubmatch(raw)
	if parts == nil {
		return 0, errors.New("metrics_invalid")
	}
	number := parts[1]
	suffix := parts[2]
	factor := 1.0
	switch suffix {
	case "n":
		factor = 1e-9
	case "u":
		factor = 1e-6
	case "m":
		factor = 1e-3
	case "":
	default:
		if len(suffix) > 1 && (suffix[0] == 'e' || suffix[0] == 'E') && suffix != "Ei" {
			number += suffix
		} else if strings.HasSuffix(suffix, "i") {
			factor = math.Pow(1024, float64(strings.Index("KMGTPE", suffix[:1])+1))
		} else {
			factor = math.Pow(1000, float64(strings.Index("kMGTPE", suffix)+1))
		}
	}
	mantissa, _ := strconv.ParseFloat(parts[1], 64)
	value, err := strconv.ParseFloat(number, 64)
	result := value * factor
	if err != nil || math.IsNaN(result) || math.IsInf(result, 0) || result > math.MaxInt64 || (mantissa > 0 && result == 0) {
		return 0, errors.New("metrics_invalid")
	}
	return result, nil
}

type containerUsage struct {
	Name      string  `json:"name"`
	CPUMilli  float64 `json:"cpuMilli"`
	MemoryMiB float64 `json:"memoryMiB"`
}

// GetPodMetrics 僅查詢指定 Pod 的採樣，不要求節點權限，也不推測未回報容器的用量。
func GetPodMetrics(raw, namespace, name string) (string, error) {
	if !validResourceName(name) {
		return "", errors.New("invalid_resource")
	}
	body, err := requestAPI(raw, namespace, apiRequest{apiPath: "apis/metrics.k8s.io/v1beta1", resource: "pods", name: name, maxBytes: 2 * 1024 * 1024, metrics: true})
	if err != nil {
		if err.Error() == "not_found" {
			return "", errors.New("metrics_missing")
		}
		return "", err
	}
	return parsePodMetrics(body, namespace, name)
}

func parsePodMetrics(body []byte, namespace, name string) (string, error) {
	var doc struct {
		Metadata   resourceMetadata `json:"metadata"`
		Timestamp  string           `json:"timestamp"`
		Window     string           `json:"window"`
		Containers []struct {
			Name  string            `json:"name"`
			Usage map[string]string `json:"usage"`
		} `json:"containers"`
	}
	if len(body) > 2*1024*1024 || json.Unmarshal(body, &doc) != nil || doc.Metadata.Name != name || doc.Metadata.Namespace != namespace || len(doc.Containers) > 200 {
		return "", errors.New("metrics_invalid")
	}
	if len(doc.Containers) == 0 {
		return "", errors.New("metrics_missing")
	}
	timestamp, timeErr := time.Parse(time.RFC3339Nano, doc.Timestamp)
	window, windowErr := time.ParseDuration(doc.Window)
	if timeErr != nil || windowErr != nil || window <= 0 {
		return "", errors.New("metrics_invalid")
	}
	result := struct {
		Timestamp     string           `json:"timestamp"`
		WindowSeconds float64          `json:"windowSeconds"`
		CPUMilli      float64          `json:"cpuMilli"`
		MemoryMiB     float64          `json:"memoryMiB"`
		Containers    []containerUsage `json:"containers"`
	}{Timestamp: timestamp.UTC().Format(time.RFC3339Nano), WindowSeconds: window.Seconds(), Containers: []containerUsage{}}
	seen := map[string]bool{}
	for _, container := range doc.Containers {
		if len(container.Name) > 63 || !namespacePattern.MatchString(container.Name) || seen[container.Name] {
			return "", errors.New("metrics_invalid")
		}
		seen[container.Name] = true
		cpu, cpuErr := usageQuantity(container.Usage["cpu"])
		memory, memoryErr := usageQuantity(container.Usage["memory"])
		if cpuErr != nil || memoryErr != nil {
			return "", errors.New("metrics_invalid")
		}
		usage := containerUsage{container.Name, cpu * 1000, memory / (1024 * 1024)}
		if memory > 0 && usage.MemoryMiB == 0 {
			return "", errors.New("metrics_invalid")
		}
		result.Containers = append(result.Containers, usage)
		result.CPUMilli += usage.CPUMilli
		result.MemoryMiB += usage.MemoryMiB
	}
	encoded, _ := json.Marshal(result)
	return string(encoded), nil
}

// ListPodMetrics 一次讀取同 namespace 的用量，避免每個清單列各自建立連線。
func ListPodMetrics(raw, namespace string) (string, error) {
	body, err := requestAPI(raw, namespace, apiRequest{apiPath: "apis/metrics.k8s.io/v1beta1", resource: "pods", query: url.Values{"limit": {"200"}}, maxBytes: 2 * 1024 * 1024, metrics: true})
	if err != nil {
		if err.Error() == "not_found" {
			return "", errors.New("metrics_missing")
		}
		return "", err
	}
	var list struct {
		Items []json.RawMessage `json:"items"`
	}
	if len(body) > 2*1024*1024 || json.Unmarshal(body, &list) != nil || list.Items == nil || len(list.Items) > 200 {
		return "", errors.New("metrics_invalid")
	}
	result := map[string]json.RawMessage{}
	for _, item := range list.Items {
		var metadata struct {
			Metadata resourceMetadata `json:"metadata"`
		}
		if json.Unmarshal(item, &metadata) != nil || !validResourceName(metadata.Metadata.Name) || metadata.Metadata.Namespace != namespace {
			return "", errors.New("metrics_invalid")
		}
		name := metadata.Metadata.Name
		if _, exists := result[name]; exists {
			return "", errors.New("metrics_invalid")
		}
		value, err := parsePodMetrics(item, namespace, name)
		if err != nil {
			continue
		}
		result[name] = json.RawMessage(value)
	}
	data, _ := json.Marshal(result)
	return string(data), nil
}
