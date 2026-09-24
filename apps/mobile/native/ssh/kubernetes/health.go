package mobilekubernetes

type healthCondition struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

type containerHealth struct {
	Ready bool `json:"ready"`
	State struct {
		Waiting *struct {
			Reason string `json:"reason"`
		} `json:"waiting"`
		Terminated *struct {
			ExitCode int `json:"exitCode"`
		} `json:"terminated"`
	} `json:"state"`
}

func failingContainers(items []containerHealth) bool {
	for _, item := range items {
		if item.State.Terminated != nil && item.State.Terminated.ExitCode != 0 {
			return true
		}
		if item.State.Waiting != nil {
			switch item.State.Waiting.Reason {
			case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "RunContainerError", "InvalidImageName":
				return true
			}
		}
	}
	return false
}

// 健康僅表示 Kubernetes 回報的就緒狀態，不代表外部端點探測結果。
func podHealth(item pod) string {
	if item.Metadata.DeletionTimestamp != nil {
		return "terminating"
	}
	if failingContainers(item.Status.ContainerStatuses) || failingContainers(item.Status.InitContainerStatuses) {
		return "unhealthy"
	}
	switch item.Status.Phase {
	case "Succeeded":
		return "completed"
	case "Failed":
		return "unhealthy"
	case "Pending":
		return "pending"
	case "Running":
		for _, c := range item.Status.Conditions {
			if c.Type == "Ready" {
				if c.Status == "True" {
					return "healthy"
				}
				if c.Status == "False" {
					return "unhealthy"
				}
				return "unknown"
			}
		}
	}
	return "unknown"
}
func workloadHealth(item resourceItem, kind string, desired int) string {
	if item.Metadata.DeletionTimestamp != nil {
		return "terminating"
	}
	if item.Status.ObservedGeneration == nil {
		return "unknown"
	}
	if *item.Status.ObservedGeneration < item.Metadata.Generation {
		return "pending"
	}
	if desired == 0 {
		return "stopped"
	}
	for _, c := range item.Status.Conditions {
		if (c.Type == "ReplicaFailure" && c.Status == "True") || ((c.Type == "Available" || c.Type == "Progressing") && c.Status == "False") {
			return "unhealthy"
		}
	}
	if item.Status.Ready < desired || (kind == "deployments" && item.Status.Available < desired) {
		return "unhealthy"
	}
	return "healthy"
}

// 清單只顯示已知狀態碼，不帶出伺服器訊息或容器輸出。
func podReason(item pod) string {
	for _, items := range [][]containerHealth{item.Status.InitContainerStatuses, item.Status.ContainerStatuses} {
		for _, container := range items {
			if container.State.Waiting != nil {
				switch container.State.Waiting.Reason {
				case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "RunContainerError", "InvalidImageName":
					return container.State.Waiting.Reason
				}
			}
		}
	}
	return ""
}
