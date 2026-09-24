package mobilekubernetes

import "math"

type resourceSpec struct {
	Limits map[string]string `json:"limits"`
}
type podContainerSpec struct {
	Name          string       `json:"name"`
	RestartPolicy string       `json:"restartPolicy"`
	Resources     resourceSpec `json:"resources"`
}
type limitValue struct {
	Value *float64 `json:"value"`
	State string   `json:"state"`
	Scope string   `json:"scope,omitempty"`
}
type containerLimits struct {
	Name   string     `json:"name"`
	CPU    limitValue `json:"cpu"`
	Memory limitValue `json:"memory"`
}
type podLimits struct {
	CPU        limitValue        `json:"cpu"`
	Memory     limitValue        `json:"memory"`
	Containers []containerLimits `json:"containers"`
}

func parseLimit(raw string, factor float64) limitValue {
	if raw == "" {
		return limitValue{State: "unset"}
	}
	value, err := usageQuantity(raw)
	if err != nil || math.IsInf(value*factor, 0) {
		return limitValue{State: "unknown"}
	}
	if value == 0 {
		return limitValue{State: "unset"}
	}
	value *= factor
	if value == 0 {
		return limitValue{State: "unknown"}
	}
	return limitValue{Value: &value, State: "set"}
}
func sumLimits(items []containerLimits, cpu bool) limitValue {
	if len(items) == 0 {
		return limitValue{State: "unknown"}
	}
	total := 0.0
	state := "set"
	for _, item := range items {
		value := item.Memory
		if cpu {
			value = item.CPU
		}
		if value.State == "unknown" {
			return limitValue{State: "unknown"}
		}
		if value.State == "unset" {
			state = "unset"
		} else if value.Value != nil {
			total += *value.Value
		}
	}
	if state != "set" {
		return limitValue{State: state, Scope: "containers"}
	}
	if math.IsInf(total, 0) {
		return limitValue{State: "unknown"}
	}
	return limitValue{Value: &total, State: "set", Scope: "containers"}
}

// Pod-level limit 優先；否則顯示一般容器與持續執行 sidecar 的上限合計。
// 任一容器未設上限時，不把部分合計誤當成 Pod 上限；不使用 requests 作分母。
func limitsForPod(item pod) podLimits {
	result := podLimits{Containers: []containerLimits{}}
	containers := append([]podContainerSpec{}, item.Spec.Containers...)
	for _, container := range item.Spec.InitContainers {
		if container.RestartPolicy == "Always" {
			containers = append(containers, container)
		}
	}
	for _, container := range containers {
		result.Containers = append(result.Containers, containerLimits{Name: container.Name, CPU: parseLimit(container.Resources.Limits["cpu"], 1000), Memory: parseLimit(container.Resources.Limits["memory"], 1.0/(1024*1024))})
	}
	result.CPU = sumLimits(result.Containers, true)
	result.Memory = sumLimits(result.Containers, false)
	if raw, ok := item.Spec.Resources.Limits["cpu"]; ok {
		result.CPU = parseLimit(raw, 1000)
		result.CPU.Scope = "pod"
	}
	if raw, ok := item.Spec.Resources.Limits["memory"]; ok {
		result.Memory = parseLimit(raw, 1.0/(1024*1024))
		result.Memory.Scope = "pod"
	}
	return result
}
