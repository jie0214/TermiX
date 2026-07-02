package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jie0214/TermiX/shared/dto"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

func (s *Service) Dashboard(ctx context.Context, request dto.KubernetesDashboardRequest) (dto.KubernetesDashboardSnapshot, error) {
	s.mu.Lock()
	if s.activeSession == nil || s.activeClients == nil {
		s.mu.Unlock()
		return dto.KubernetesDashboardSnapshot{}, errors.New("尚未連接 Kubernetes Cluster")
	}
	session := *s.activeSession
	clients := s.activeClients
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	namespace := strings.TrimSpace(request.Namespace)
	if namespace == "" {
		namespace = strings.TrimSpace(session.Namespace)
	}
	if namespace == "" {
		namespace = "default"
	}
	queryNamespace := namespace
	if namespace == "*" {
		queryNamespace = metav1.NamespaceAll
	}

	namespaceList, err := clients.core.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return dto.KubernetesDashboardSnapshot{}, resourceListError("Namespaces", err)
	}
	resourceErrors := make(map[string]string)
	nodeItems := []corev1.Node{}
	if nodeList, listErr := clients.core.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); listErr != nil {
		if !apierrors.IsForbidden(listErr) {
			return dto.KubernetesDashboardSnapshot{}, resourceListError("Nodes", listErr)
		}
		resourceErrors["nodes"] = resourceListError("Nodes", listErr).Error()
	} else {
		nodeItems = nodeList.Items
	}
	podList, err := clients.core.CoreV1().Pods(queryNamespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return dto.KubernetesDashboardSnapshot{}, resourceListError("Pods", err)
	}
	deploymentList, err := clients.core.AppsV1().Deployments(queryNamespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return dto.KubernetesDashboardSnapshot{}, resourceListError("Deployments", err)
	}
	statefulSetList, err := clients.core.AppsV1().StatefulSets(queryNamespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return dto.KubernetesDashboardSnapshot{}, resourceListError("StatefulSets", err)
	}
	daemonSetItems := []appsv1.DaemonSet{}
	if daemonSetList, listErr := clients.core.AppsV1().DaemonSets(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["daemonSets"] = resourceListError("DaemonSets", listErr).Error()
	} else {
		daemonSetItems = daemonSetList.Items
	}
	jobItems := []batchv1.Job{}
	if jobList, listErr := clients.core.BatchV1().Jobs(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["jobs"] = resourceListError("Jobs", listErr).Error()
	} else {
		jobItems = jobList.Items
	}
	cronJobItems := []batchv1.CronJob{}
	if cronJobList, listErr := clients.core.BatchV1().CronJobs(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["cronJobs"] = resourceListError("CronJobs", listErr).Error()
	} else {
		cronJobItems = cronJobList.Items
	}
	serviceItems := []corev1.Service{}
	if serviceList, listErr := clients.core.CoreV1().Services(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["services"] = resourceListError("Services", listErr).Error()
	} else {
		serviceItems = serviceList.Items
	}
	ingressItems := []networkingv1.Ingress{}
	if ingressList, listErr := clients.core.NetworkingV1().Ingresses(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["ingresses"] = resourceListError("Ingresses", listErr).Error()
	} else {
		ingressItems = ingressList.Items
	}
	pvcItems := []corev1.PersistentVolumeClaim{}
	if pvcList, listErr := clients.core.CoreV1().PersistentVolumeClaims(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["persistentVolumeClaims"] = resourceListError("PersistentVolumeClaims", listErr).Error()
	} else {
		pvcItems = pvcList.Items
	}
	pvItems := []corev1.PersistentVolume{}
	if pvList, listErr := clients.core.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["persistentVolumes"] = resourceListError("PersistentVolumes", listErr).Error()
	} else {
		pvItems = pvList.Items
	}
	storageClassItems := []storagev1.StorageClass{}
	if storageClassList, listErr := clients.core.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["storageClasses"] = resourceListError("StorageClasses", listErr).Error()
	} else {
		storageClassItems = storageClassList.Items
	}
	configMapItems := []corev1.ConfigMap{}
	if configMapList, listErr := clients.core.CoreV1().ConfigMaps(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["configMaps"] = resourceListError("ConfigMaps", listErr).Error()
	} else {
		configMapItems = configMapList.Items
	}
	secretItems := []corev1.Secret{}
	if secretList, listErr := clients.core.CoreV1().Secrets(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["secrets"] = resourceListError("Secrets", listErr).Error()
	} else {
		secretItems = secretList.Items
	}
	endpointsItems := []corev1.Endpoints{}
	if endpointsList, listErr := clients.core.CoreV1().Endpoints(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["endpoints"] = resourceListError("Endpoints", listErr).Error()
	} else {
		endpointsItems = endpointsList.Items
	}
	networkPolicyItems := []networkingv1.NetworkPolicy{}
	if networkPolicyList, listErr := clients.core.NetworkingV1().NetworkPolicies(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["networkPolicies"] = resourceListError("NetworkPolicies", listErr).Error()
	} else {
		networkPolicyItems = networkPolicyList.Items
	}
	serviceAccountItems := []corev1.ServiceAccount{}
	if serviceAccountList, listErr := clients.core.CoreV1().ServiceAccounts(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["serviceAccounts"] = resourceListError("ServiceAccounts", listErr).Error()
	} else {
		serviceAccountItems = serviceAccountList.Items
	}
	roleItems := []rbacv1.Role{}
	if roleList, listErr := clients.core.RbacV1().Roles(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["roles"] = resourceListError("Roles", listErr).Error()
	} else {
		roleItems = roleList.Items
	}
	roleBindingItems := []rbacv1.RoleBinding{}
	if roleBindingList, listErr := clients.core.RbacV1().RoleBindings(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["roleBindings"] = resourceListError("RoleBindings", listErr).Error()
	} else {
		roleBindingItems = roleBindingList.Items
	}
	clusterRoleItems := []rbacv1.ClusterRole{}
	if clusterRoleList, listErr := clients.core.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["clusterRoles"] = resourceListError("ClusterRoles", listErr).Error()
	} else {
		clusterRoleItems = clusterRoleList.Items
	}
	clusterRoleBindingItems := []rbacv1.ClusterRoleBinding{}
	if clusterRoleBindingList, listErr := clients.core.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["clusterRoleBindings"] = resourceListError("ClusterRoleBindings", listErr).Error()
	} else {
		clusterRoleBindingItems = clusterRoleBindingList.Items
	}
	hpaItems := []autoscalingv2.HorizontalPodAutoscaler{}
	if hpaList, listErr := clients.core.AutoscalingV2().HorizontalPodAutoscalers(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["horizontalPodAutoscalers"] = resourceListError("HorizontalPodAutoscalers", listErr).Error()
	} else {
		hpaItems = hpaList.Items
	}
	pdbItems := []policyv1.PodDisruptionBudget{}
	if pdbList, listErr := clients.core.PolicyV1().PodDisruptionBudgets(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["podDisruptionBudgets"] = resourceListError("PodDisruptionBudgets", listErr).Error()
	} else {
		pdbItems = pdbList.Items
	}
	resourceQuotaItems := []corev1.ResourceQuota{}
	if resourceQuotaList, listErr := clients.core.CoreV1().ResourceQuotas(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["resourceQuotas"] = resourceListError("ResourceQuotas", listErr).Error()
	} else {
		resourceQuotaItems = resourceQuotaList.Items
	}
	// CRD 為 cluster-scoped，不受 queryNamespace 影響，並改走 dynamic client。
	// 測試用的 clusterClients 沒有 dynamic（為 nil），故必須 nil-guard 以免 panic。
	crdItems := []unstructured.Unstructured{}
	if clients.dynamic != nil {
		crdGVR := schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}
		if crdList, listErr := clients.dynamic.Resource(crdGVR).List(ctx, metav1.ListOptions{}); listErr != nil {
			resourceErrors["customResourceDefinitions"] = resourceListError("CustomResourceDefinitions", listErr).Error()
		} else {
			crdItems = crdList.Items
		}
	}
	eventItems := []corev1.Event{}
	if eventList, listErr := clients.core.CoreV1().Events(queryNamespace).List(ctx, metav1.ListOptions{}); listErr != nil {
		resourceErrors["events"] = resourceListError("Events", listErr).Error()
	} else {
		eventItems = eventList.Items
	}

	snapshot := dto.KubernetesDashboardSnapshot{
		SessionID:                 session.SessionID,
		ClusterName:               session.ClusterName,
		ContextName:               session.ContextName,
		Namespace:                 namespace,
		ServerVersion:             clients.serverVersion,
		GeneratedAt:               time.Now().UTC().Format(time.RFC3339Nano),
		Namespaces:                make([]string, 0, len(namespaceList.Items)),
		NamespaceDetails:          make([]dto.KubernetesNamespaceSummary, 0, len(namespaceList.Items)),
		Nodes:                     make([]dto.KubernetesNodeSummary, 0, len(nodeItems)),
		Pods:                      make([]dto.KubernetesPodSummary, 0, len(podList.Items)),
		Deployments:               make([]dto.KubernetesWorkloadSummary, 0, len(deploymentList.Items)),
		StatefulSets:              make([]dto.KubernetesWorkloadSummary, 0, len(statefulSetList.Items)),
		DaemonSets:                make([]dto.KubernetesWorkloadSummary, 0, len(daemonSetItems)),
		Jobs:                      make([]dto.KubernetesJobSummary, 0, len(jobItems)),
		CronJobs:                  make([]dto.KubernetesCronJobSummary, 0, len(cronJobItems)),
		Services:                  make([]dto.KubernetesServiceSummary, 0, len(serviceItems)),
		Ingresses:                 make([]dto.KubernetesIngressSummary, 0, len(ingressItems)),
		PersistentVolumeClaims:    make([]dto.KubernetesPersistentVolumeClaimSummary, 0, len(pvcItems)),
		PersistentVolumes:         make([]dto.KubernetesPersistentVolumeSummary, 0, len(pvItems)),
		StorageClasses:            make([]dto.KubernetesStorageClassSummary, 0, len(storageClassItems)),
		ConfigMaps:                make([]dto.KubernetesConfigMapSummary, 0, len(configMapItems)),
		Secrets:                   make([]dto.KubernetesSecretSummary, 0, len(secretItems)),
		Endpoints:                 make([]dto.KubernetesEndpointsSummary, 0, len(endpointsItems)),
		NetworkPolicies:           make([]dto.KubernetesNetworkPolicySummary, 0, len(networkPolicyItems)),
		ServiceAccounts:           make([]dto.KubernetesServiceAccountSummary, 0, len(serviceAccountItems)),
		Roles:                     make([]dto.KubernetesRoleSummary, 0, len(roleItems)),
		RoleBindings:              make([]dto.KubernetesRoleBindingSummary, 0, len(roleBindingItems)),
		ClusterRoles:              make([]dto.KubernetesClusterRoleSummary, 0, len(clusterRoleItems)),
		ClusterRoleBindings:       make([]dto.KubernetesClusterRoleBindingSummary, 0, len(clusterRoleBindingItems)),
		HorizontalPodAutoscalers:  make([]dto.KubernetesHorizontalPodAutoscalerSummary, 0, len(hpaItems)),
		PodDisruptionBudgets:      make([]dto.KubernetesPodDisruptionBudgetSummary, 0, len(pdbItems)),
		ResourceQuotas:            make([]dto.KubernetesResourceQuotaSummary, 0, len(resourceQuotaItems)),
		CustomResourceDefinitions: make([]dto.KubernetesCustomResourceDefinitionSummary, 0, len(crdItems)),
		ResourceErrors:            resourceErrors,
		Events:                    make([]dto.KubernetesEventSummary, 0, len(eventItems)),
	}
	for _, item := range namespaceList.Items {
		snapshot.Namespaces = append(snapshot.Namespaces, item.Name)
		snapshot.NamespaceDetails = append(snapshot.NamespaceDetails, namespaceSummary(item))
	}
	sort.Strings(snapshot.Namespaces)
	for _, item := range nodeItems {
		summary := nodeSummary(item)
		snapshot.Nodes = append(snapshot.Nodes, summary)
		snapshot.Metrics.CPUCapacityMilli += summary.CPUCapacityMilli
		snapshot.Metrics.MemoryCapacityBytes += summary.MemoryCapacityBytes
		if summary.Status == "Ready" {
			snapshot.Overview.ReadyNodes++
		}
	}
	for _, item := range podList.Items {
		summary := podSummary(item)
		snapshot.Pods = append(snapshot.Pods, summary)
		switch item.Status.Phase {
		case corev1.PodRunning:
			snapshot.Overview.RunningPods++
		case corev1.PodPending:
			snapshot.Overview.PendingPods++
		case corev1.PodFailed:
			snapshot.Overview.FailedPods++
		case corev1.PodSucceeded:
			snapshot.Overview.SucceededPods++
		}
	}
	for _, item := range deploymentList.Items {
		summary := deploymentSummary(item)
		snapshot.Deployments = append(snapshot.Deployments, summary)
		if summary.Status == "Ready" {
			snapshot.Overview.ReadyDeployments++
		}
	}
	for _, item := range statefulSetList.Items {
		summary := statefulSetSummary(item)
		snapshot.StatefulSets = append(snapshot.StatefulSets, summary)
		if summary.Status == "Ready" {
			snapshot.Overview.ReadyStatefulSets++
		}
	}
	for _, item := range daemonSetItems {
		snapshot.DaemonSets = append(snapshot.DaemonSets, daemonSetSummary(item))
	}
	for _, item := range jobItems {
		snapshot.Jobs = append(snapshot.Jobs, jobSummary(item))
	}
	for _, item := range cronJobItems {
		snapshot.CronJobs = append(snapshot.CronJobs, cronJobSummary(item))
	}
	for _, item := range serviceItems {
		snapshot.Services = append(snapshot.Services, serviceSummary(item))
	}
	for _, item := range ingressItems {
		snapshot.Ingresses = append(snapshot.Ingresses, ingressSummary(item))
	}
	for _, item := range pvcItems {
		snapshot.PersistentVolumeClaims = append(snapshot.PersistentVolumeClaims, persistentVolumeClaimSummary(item))
	}
	for _, item := range pvItems {
		snapshot.PersistentVolumes = append(snapshot.PersistentVolumes, persistentVolumeSummary(item))
	}
	for _, item := range storageClassItems {
		snapshot.StorageClasses = append(snapshot.StorageClasses, storageClassSummary(item))
	}
	for _, item := range configMapItems {
		snapshot.ConfigMaps = append(snapshot.ConfigMaps, configMapSummary(item))
	}
	for _, item := range secretItems {
		snapshot.Secrets = append(snapshot.Secrets, secretSummary(item))
	}
	for _, item := range endpointsItems {
		snapshot.Endpoints = append(snapshot.Endpoints, endpointsSummary(item))
	}
	for _, item := range networkPolicyItems {
		snapshot.NetworkPolicies = append(snapshot.NetworkPolicies, networkPolicySummary(item))
	}
	for _, item := range serviceAccountItems {
		snapshot.ServiceAccounts = append(snapshot.ServiceAccounts, serviceAccountSummary(item))
	}
	for _, item := range roleItems {
		snapshot.Roles = append(snapshot.Roles, roleSummary(item))
	}
	for _, item := range roleBindingItems {
		snapshot.RoleBindings = append(snapshot.RoleBindings, roleBindingSummary(item))
	}
	for _, item := range clusterRoleItems {
		snapshot.ClusterRoles = append(snapshot.ClusterRoles, clusterRoleSummary(item))
	}
	for _, item := range clusterRoleBindingItems {
		snapshot.ClusterRoleBindings = append(snapshot.ClusterRoleBindings, clusterRoleBindingSummary(item))
	}
	for _, item := range hpaItems {
		snapshot.HorizontalPodAutoscalers = append(snapshot.HorizontalPodAutoscalers, horizontalPodAutoscalerSummary(item))
	}
	for _, item := range pdbItems {
		snapshot.PodDisruptionBudgets = append(snapshot.PodDisruptionBudgets, podDisruptionBudgetSummary(item))
	}
	for _, item := range resourceQuotaItems {
		snapshot.ResourceQuotas = append(snapshot.ResourceQuotas, resourceQuotaSummary(item))
	}
	for _, item := range crdItems {
		snapshot.CustomResourceDefinitions = append(snapshot.CustomResourceDefinitions, customResourceDefinitionSummary(item))
	}
	for _, item := range eventItems {
		snapshot.Events = append(snapshot.Events, eventSummary(item))
		if item.Type == corev1.EventTypeWarning {
			snapshot.Overview.WarningEvents++
		}
	}
	snapshot.Overview.Nodes = len(snapshot.Nodes)
	snapshot.Overview.Pods = len(snapshot.Pods)
	snapshot.Overview.Deployments = len(snapshot.Deployments)
	snapshot.Overview.StatefulSets = len(snapshot.StatefulSets)
	snapshot.Overview.Services = len(snapshot.Services)
	sortDashboardItems(&snapshot)
	loadMetrics(ctx, clients, queryNamespace, &snapshot)
	return snapshot, nil
}

func resourceListError(resource string, err error) error {
	switch {
	case apierrors.IsForbidden(err):
		return fmt.Errorf("讀取 %s 失敗：目前 kubeconfig 身分沒有存取權限", resource)
	case apierrors.IsUnauthorized(err):
		return fmt.Errorf("讀取 %s 失敗：Kubernetes 認證已失效", resource)
	default:
		// 認證外掛程式可能將輸出包在底層錯誤中，不直接傳回前端。
		return fmt.Errorf("讀取 %s 失敗：請檢查網路、API Server 與 kubeconfig 認證設定", resource)
	}
}

func namespaceSummary(item corev1.Namespace) dto.KubernetesNamespaceSummary {
	status := string(item.Status.Phase)
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	}
	return dto.KubernetesNamespaceSummary{
		Name: item.Name, Status: status, CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func nodeSummary(item corev1.Node) dto.KubernetesNodeSummary {
	status := "NotReady"
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	} else {
		for _, condition := range item.Status.Conditions {
			if condition.Type == corev1.NodeReady && condition.Status == corev1.ConditionTrue {
				status = "Ready"
				break
			}
		}
	}
	roles := make([]string, 0)
	for key, value := range item.Labels {
		if strings.HasPrefix(key, "node-role.kubernetes.io/") {
			role := strings.TrimPrefix(key, "node-role.kubernetes.io/")
			if role != "" {
				roles = append(roles, role)
			}
		}
		if key == "kubernetes.io/role" && value != "" {
			roles = append(roles, value)
		}
	}
	sort.Strings(roles)
	cpu := item.Status.Capacity.Cpu()
	memory := item.Status.Capacity.Memory()
	return dto.KubernetesNodeSummary{
		Name: item.Name, Status: status, Roles: strings.Join(roles, ", "), Version: item.Status.NodeInfo.KubeletVersion,
		CPUCapacityMilli: cpu.MilliValue(), MemoryCapacityBytes: memory.Value(), CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func podSummary(item corev1.Pod) dto.KubernetesPodSummary {
	ready := 0
	var restarts int32
	for _, status := range item.Status.ContainerStatuses {
		if status.Ready {
			ready++
		}
		restarts += status.RestartCount
	}
	containers := make([]dto.KubernetesPodContainerSummary, 0, len(item.Spec.Containers))
	for _, container := range item.Spec.Containers {
		containers = append(containers, dto.KubernetesPodContainerSummary{Name: container.Name, Ports: containerPorts(container.Ports)})
	}
	return dto.KubernetesPodSummary{
		Name: item.Name, Namespace: item.Namespace, UID: string(item.UID), Phase: string(item.Status.Phase), Status: podDisplayStatus(item),
		Ready: fmt.Sprintf("%d/%d", ready, len(item.Spec.Containers)), Restarts: restarts, NodeName: item.Spec.NodeName,
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339), Containers: containers,
	}
}

func podDisplayStatus(item corev1.Pod) string {
	if item.DeletionTimestamp != nil {
		return "Terminating"
	}
	for _, status := range item.Status.InitContainerStatuses {
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" {
			return status.State.Waiting.Reason
		}
		if status.State.Terminated != nil && status.State.Terminated.ExitCode != 0 && status.State.Terminated.Reason != "" {
			return status.State.Terminated.Reason
		}
	}
	for _, status := range item.Status.ContainerStatuses {
		if status.State.Waiting != nil && status.State.Waiting.Reason != "" {
			return status.State.Waiting.Reason
		}
		if status.State.Terminated != nil && status.State.Terminated.ExitCode != 0 && status.State.Terminated.Reason != "" {
			return status.State.Terminated.Reason
		}
	}
	if item.Status.Reason != "" {
		return item.Status.Reason
	}
	if item.Status.Phase == "" {
		return "Unknown"
	}
	return string(item.Status.Phase)
}

func deploymentSummary(item appsv1.Deployment) dto.KubernetesWorkloadSummary {
	desired := int32(1)
	if item.Spec.Replicas != nil {
		desired = *item.Spec.Replicas
	}
	status := "Progressing"
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	} else if item.Status.ReadyReplicas >= desired {
		status = "Ready"
	} else if item.Status.UnavailableReplicas > 0 {
		status = "Degraded"
	}
	return dto.KubernetesWorkloadSummary{
		Name: item.Name, Namespace: item.Namespace, DesiredReplicas: desired, ReadyReplicas: item.Status.ReadyReplicas,
		AvailableReplicas: item.Status.AvailableReplicas, Status: status, CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func statefulSetSummary(item appsv1.StatefulSet) dto.KubernetesWorkloadSummary {
	desired := int32(1)
	if item.Spec.Replicas != nil {
		desired = *item.Spec.Replicas
	}
	status := "Progressing"
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	} else if item.Status.ReadyReplicas >= desired {
		status = "Ready"
	}
	return dto.KubernetesWorkloadSummary{
		Name: item.Name, Namespace: item.Namespace, DesiredReplicas: desired, ReadyReplicas: item.Status.ReadyReplicas,
		AvailableReplicas: item.Status.AvailableReplicas, Status: status, CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func daemonSetSummary(item appsv1.DaemonSet) dto.KubernetesWorkloadSummary {
	desired := item.Status.DesiredNumberScheduled
	status := "Progressing"
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	} else if desired > 0 && item.Status.NumberReady >= desired {
		status = "Ready"
	}
	return dto.KubernetesWorkloadSummary{
		Name: item.Name, Namespace: item.Namespace, DesiredReplicas: desired, ReadyReplicas: item.Status.NumberReady,
		AvailableReplicas: item.Status.NumberAvailable, Status: status, CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func jobSummary(item batchv1.Job) dto.KubernetesJobSummary {
	desired := "1"
	if item.Spec.Completions != nil {
		desired = fmt.Sprintf("%d", *item.Spec.Completions)
	}
	status := "Running"
	for _, cond := range item.Status.Conditions {
		if cond.Status != corev1.ConditionTrue {
			continue
		}
		if cond.Type == batchv1.JobComplete {
			status = "Complete"
			break
		}
		if cond.Type == batchv1.JobFailed {
			status = "Failed"
			break
		}
	}
	if status == "Running" && item.Status.Active == 0 {
		if item.Status.Failed > 0 {
			status = "Failed"
		} else if item.Status.Succeeded > 0 {
			status = "Complete"
		} else {
			status = "Pending"
		}
	}
	return dto.KubernetesJobSummary{
		Name: item.Name, Namespace: item.Namespace,
		Completions:       fmt.Sprintf("%d/%s", item.Status.Succeeded, desired),
		Succeeded:         item.Status.Succeeded,
		Status:            status,
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func cronJobSummary(item batchv1.CronJob) dto.KubernetesCronJobSummary {
	suspend := false
	if item.Spec.Suspend != nil {
		suspend = *item.Spec.Suspend
	}
	lastSchedule := "-"
	if item.Status.LastScheduleTime != nil {
		lastSchedule = item.Status.LastScheduleTime.UTC().Format(time.RFC3339)
	}
	return dto.KubernetesCronJobSummary{
		Name: item.Name, Namespace: item.Namespace,
		Schedule:          item.Spec.Schedule,
		Suspend:           suspend,
		Active:            len(item.Status.Active),
		LastSchedule:      lastSchedule,
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func serviceSummary(item corev1.Service) dto.KubernetesServiceSummary {
	addresses := append([]string{}, item.Spec.ExternalIPs...)
	for _, ingress := range item.Status.LoadBalancer.Ingress {
		addresses = append(addresses, ingress.IP, ingress.Hostname)
	}
	ports := make([]string, 0, len(item.Spec.Ports))
	for _, port := range item.Spec.Ports {
		value := fmt.Sprintf("%d/%s", port.Port, port.Protocol)
		if port.NodePort > 0 {
			value += fmt.Sprintf("->%d", port.NodePort)
		}
		ports = append(ports, value)
	}
	return dto.KubernetesServiceSummary{
		Name: item.Name, Namespace: item.Namespace, Type: string(item.Spec.Type), ClusterIP: item.Spec.ClusterIP,
		ExternalAddresses: strings.Join(sortedNonEmpty(addresses), ", "), Ports: strings.Join(ports, ", "),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func ingressSummary(item networkingv1.Ingress) dto.KubernetesIngressSummary {
	hosts := make([]string, 0, len(item.Spec.Rules))
	for _, rule := range item.Spec.Rules {
		hosts = append(hosts, rule.Host)
	}
	addresses := make([]string, 0, len(item.Status.LoadBalancer.Ingress)*2)
	for _, ingress := range item.Status.LoadBalancer.Ingress {
		addresses = append(addresses, ingress.IP, ingress.Hostname)
	}
	ingressClass := ""
	if item.Spec.IngressClassName != nil {
		ingressClass = *item.Spec.IngressClassName
	}
	return dto.KubernetesIngressSummary{
		Name: item.Name, Namespace: item.Namespace, IngressClass: ingressClass,
		Hosts: strings.Join(sortedNonEmpty(hosts), ", "), Addresses: strings.Join(sortedNonEmpty(addresses), ", "),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func persistentVolumeClaimSummary(item corev1.PersistentVolumeClaim) dto.KubernetesPersistentVolumeClaimSummary {
	storageClass := ""
	if item.Spec.StorageClassName != nil {
		storageClass = *item.Spec.StorageClassName
	}
	status := string(item.Status.Phase)
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	}
	return dto.KubernetesPersistentVolumeClaimSummary{
		Name: item.Name, Namespace: item.Namespace, Status: status, VolumeName: item.Spec.VolumeName,
		Capacity: quantityString(item.Status.Capacity, corev1.ResourceStorage), StorageClass: storageClass,
		AccessModes: strings.Join(accessModeStrings(item.Status.AccessModes), ", "), CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func persistentVolumeSummary(item corev1.PersistentVolume) dto.KubernetesPersistentVolumeSummary {
	claim := ""
	if item.Spec.ClaimRef != nil {
		claim = item.Spec.ClaimRef.Namespace + "/" + item.Spec.ClaimRef.Name
	}
	status := string(item.Status.Phase)
	if item.DeletionTimestamp != nil {
		status = "Terminating"
	}
	return dto.KubernetesPersistentVolumeSummary{
		Name: item.Name, Status: status, Capacity: quantityString(item.Spec.Capacity, corev1.ResourceStorage),
		StorageClass: item.Spec.StorageClassName, AccessModes: strings.Join(accessModeStrings(item.Spec.AccessModes), ", "),
		ReclaimPolicy: string(item.Spec.PersistentVolumeReclaimPolicy), Claim: claim,
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func storageClassSummary(item storagev1.StorageClass) dto.KubernetesStorageClassSummary {
	reclaimPolicy := ""
	if item.ReclaimPolicy != nil {
		reclaimPolicy = string(*item.ReclaimPolicy)
	}
	bindingMode := ""
	if item.VolumeBindingMode != nil {
		bindingMode = string(*item.VolumeBindingMode)
	}
	allowExpansion := item.AllowVolumeExpansion != nil && *item.AllowVolumeExpansion
	return dto.KubernetesStorageClassSummary{
		Name: item.Name, Provisioner: item.Provisioner, ReclaimPolicy: reclaimPolicy, VolumeBindingMode: bindingMode,
		AllowExpansion: allowExpansion, IsDefault: item.Annotations["storageclass.kubernetes.io/is-default-class"] == "true",
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func configMapSummary(item corev1.ConfigMap) dto.KubernetesConfigMapSummary {
	return dto.KubernetesConfigMapSummary{
		Name: item.Name, Namespace: item.Namespace,
		DataKeys:          len(item.Data) + len(item.BinaryData),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

// secretSummary 只讀取 Secret 的 metadata、型別與 key 數量（len(item.Data)），
// 絕不讀取或傳遞任何 Secret 的 value 內容。
func secretSummary(item corev1.Secret) dto.KubernetesSecretSummary {
	return dto.KubernetesSecretSummary{
		Name: item.Name, Namespace: item.Namespace, Type: string(item.Type),
		DataKeys:          len(item.Data),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func endpointsSummary(item corev1.Endpoints) dto.KubernetesEndpointsSummary {
	addresses := 0
	for _, subset := range item.Subsets {
		addresses += len(subset.Addresses)
	}
	return dto.KubernetesEndpointsSummary{
		Name: item.Name, Namespace: item.Namespace, Addresses: addresses,
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func networkPolicySummary(item networkingv1.NetworkPolicy) dto.KubernetesNetworkPolicySummary {
	policyTypes := make([]string, 0, len(item.Spec.PolicyTypes))
	for _, policyType := range item.Spec.PolicyTypes {
		policyTypes = append(policyTypes, string(policyType))
	}
	joined := strings.Join(policyTypes, ",")
	if joined == "" {
		joined = "-"
	}
	return dto.KubernetesNetworkPolicySummary{
		Name: item.Name, Namespace: item.Namespace, PolicyTypes: joined,
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

// serviceAccountSummary 僅讀取 ServiceAccount 的 metadata 與關聯 secret「數量」（len(item.Secrets)），
// 絕不讀取或傳遞任何 secret 名稱或 token 值。
func serviceAccountSummary(item corev1.ServiceAccount) dto.KubernetesServiceAccountSummary {
	return dto.KubernetesServiceAccountSummary{
		Name: item.Name, Namespace: item.Namespace, Secrets: len(item.Secrets),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func roleSummary(item rbacv1.Role) dto.KubernetesRoleSummary {
	return dto.KubernetesRoleSummary{
		Name: item.Name, Namespace: item.Namespace, Rules: len(item.Rules),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func roleBindingSummary(item rbacv1.RoleBinding) dto.KubernetesRoleBindingSummary {
	return dto.KubernetesRoleBindingSummary{
		Name: item.Name, Namespace: item.Namespace,
		RoleRef:           item.RoleRef.Kind + "/" + item.RoleRef.Name,
		Subjects:          len(item.Subjects),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func clusterRoleSummary(item rbacv1.ClusterRole) dto.KubernetesClusterRoleSummary {
	return dto.KubernetesClusterRoleSummary{
		Name: item.Name, Rules: len(item.Rules),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

func clusterRoleBindingSummary(item rbacv1.ClusterRoleBinding) dto.KubernetesClusterRoleBindingSummary {
	return dto.KubernetesClusterRoleBindingSummary{
		Name:              item.Name,
		RoleRef:           item.RoleRef.Kind + "/" + item.RoleRef.Name,
		Subjects:          len(item.Subjects),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

// horizontalPodAutoscalerSummary 讀取 HPA 的縮放目標與副本數範圍；MinReplicas 為 nil 時視為 1。
func horizontalPodAutoscalerSummary(item autoscalingv2.HorizontalPodAutoscaler) dto.KubernetesHorizontalPodAutoscalerSummary {
	minReplicas := int32(1)
	if item.Spec.MinReplicas != nil {
		minReplicas = *item.Spec.MinReplicas
	}
	return dto.KubernetesHorizontalPodAutoscalerSummary{
		Name: item.Name, Namespace: item.Namespace,
		Reference:         item.Spec.ScaleTargetRef.Kind + "/" + item.Spec.ScaleTargetRef.Name,
		MinReplicas:       int(minReplicas),
		MaxReplicas:       int(item.Spec.MaxReplicas),
		CurrentReplicas:   int(item.Status.CurrentReplicas),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

// podDisruptionBudgetSummary 讀取 PDB 的可用副本設定與狀態；minAvailable/maxUnavailable 為 nil 時以 "-" 表示。
func podDisruptionBudgetSummary(item policyv1.PodDisruptionBudget) dto.KubernetesPodDisruptionBudgetSummary {
	minAvailable := "-"
	if item.Spec.MinAvailable != nil {
		minAvailable = item.Spec.MinAvailable.String()
	}
	maxUnavailable := "-"
	if item.Spec.MaxUnavailable != nil {
		maxUnavailable = item.Spec.MaxUnavailable.String()
	}
	return dto.KubernetesPodDisruptionBudgetSummary{
		Name: item.Name, Namespace: item.Namespace,
		MinAvailable:      minAvailable,
		MaxUnavailable:    maxUnavailable,
		CurrentHealthy:    int(item.Status.CurrentHealthy),
		DesiredHealthy:    int(item.Status.DesiredHealthy),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

// resourceQuotaSummary 讀取 ResourceQuota 的硬限制數量與適用範圍；HardLimits 優先取 Status.Hard，為 0 時退回 Spec.Hard。
func resourceQuotaSummary(item corev1.ResourceQuota) dto.KubernetesResourceQuotaSummary {
	hardLimits := len(item.Status.Hard)
	if hardLimits == 0 {
		hardLimits = len(item.Spec.Hard)
	}
	scopes := make([]string, 0, len(item.Spec.Scopes))
	for _, scope := range item.Spec.Scopes {
		scopes = append(scopes, string(scope))
	}
	return dto.KubernetesResourceQuotaSummary{
		Name: item.Name, Namespace: item.Namespace,
		HardLimits:        hardLimits,
		Scopes:            strings.Join(scopes, ","),
		CreationTimestamp: item.CreationTimestamp.UTC().Format(time.RFC3339),
	}
}

// customResourceDefinitionSummary 透過 unstructured 讀取 CRD 的 group/kind/scope 與已 served 版本（cluster-scoped，無 Namespace）。
func customResourceDefinitionSummary(item unstructured.Unstructured) dto.KubernetesCustomResourceDefinitionSummary {
	group, _, _ := unstructured.NestedString(item.Object, "spec", "group")
	kind, _, _ := unstructured.NestedString(item.Object, "spec", "names", "kind")
	scope, _, _ := unstructured.NestedString(item.Object, "spec", "scope")
	versions := make([]string, 0)
	if versionList, found, _ := unstructured.NestedSlice(item.Object, "spec", "versions"); found {
		for _, raw := range versionList {
			versionMap, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			served, _, _ := unstructured.NestedBool(versionMap, "served")
			if !served {
				continue
			}
			if name, _, _ := unstructured.NestedString(versionMap, "name"); name != "" {
				versions = append(versions, name)
			}
		}
	}
	creation := item.GetCreationTimestamp()
	return dto.KubernetesCustomResourceDefinitionSummary{
		Name: item.GetName(), Group: group, Kind: kind, Scope: scope,
		Versions:          strings.Join(versions, ","),
		CreationTimestamp: creation.UTC().Format(time.RFC3339),
	}
}

func quantityString(values corev1.ResourceList, name corev1.ResourceName) string {
	if quantity, found := values[name]; found {
		return quantity.String()
	}
	return ""
}

func accessModeStrings(values []corev1.PersistentVolumeAccessMode) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, string(value))
	}
	return result
}

func sortedNonEmpty(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, found := seen[value]; found {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func loadMetrics(ctx context.Context, clients *clusterClients, namespace string, snapshot *dto.KubernetesDashboardSnapshot) {
	if clients.metrics == nil {
		snapshot.Metrics.Error = "叢集未提供 Metrics API"
		return
	}
	nodeMetrics, nodeErr := clients.metrics.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	podMetrics, podErr := clients.metrics.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if nodeErr != nil || podErr != nil {
		snapshot.Metrics.Available = false
		snapshot.Metrics.Error = metricsError(nodeErr, podErr)
		return
	}
	nodeByName := make(map[string]metricsv1beta1.NodeMetrics, len(nodeMetrics.Items))
	for _, item := range nodeMetrics.Items {
		nodeByName[item.Name] = item
	}
	for index := range snapshot.Nodes {
		metric, found := nodeByName[snapshot.Nodes[index].Name]
		if !found {
			continue
		}
		snapshot.Nodes[index].CPUUsageMilli = metric.Usage.Cpu().MilliValue()
		snapshot.Nodes[index].MemoryUsageBytes = metric.Usage.Memory().Value()
		snapshot.Metrics.CPUUsageMilli += snapshot.Nodes[index].CPUUsageMilli
		snapshot.Metrics.MemoryUsageBytes += snapshot.Nodes[index].MemoryUsageBytes
	}
	podByKey := make(map[string]metricsv1beta1.PodMetrics, len(podMetrics.Items))
	for _, item := range podMetrics.Items {
		podByKey[item.Namespace+"\x00"+item.Name] = item
	}
	for index := range snapshot.Pods {
		metric, found := podByKey[snapshot.Pods[index].Namespace+"\x00"+snapshot.Pods[index].Name]
		if !found {
			continue
		}
		for _, container := range metric.Containers {
			snapshot.Pods[index].CPUUsageMilli += container.Usage.Cpu().MilliValue()
			snapshot.Pods[index].MemoryUsageBytes += container.Usage.Memory().Value()
		}
	}
	snapshot.Metrics.Available = true
}

func metricsError(errs ...error) string {
	for _, err := range errs {
		if err == nil {
			continue
		}
		if apierrors.IsForbidden(err) {
			return "Metrics API 權限不足"
		}
		if apierrors.IsUnauthorized(err) {
			return "Metrics API 認證已失效"
		}
		if apierrors.IsNotFound(err) || apierrors.IsServiceUnavailable(err) {
			return "叢集未提供 Metrics API"
		}
		return "Metrics API 無法使用"
	}
	return ""
}

func sortDashboardItems(snapshot *dto.KubernetesDashboardSnapshot) {
	sortEvents(snapshot.Events)
	sort.Slice(snapshot.NamespaceDetails, func(i, j int) bool { return snapshot.NamespaceDetails[i].Name < snapshot.NamespaceDetails[j].Name })
	sort.Slice(snapshot.Nodes, func(i, j int) bool { return snapshot.Nodes[i].Name < snapshot.Nodes[j].Name })
	sort.Slice(snapshot.Pods, func(i, j int) bool {
		return snapshot.Pods[i].Namespace+"/"+snapshot.Pods[i].Name < snapshot.Pods[j].Namespace+"/"+snapshot.Pods[j].Name
	})
	sort.Slice(snapshot.Deployments, func(i, j int) bool {
		return snapshot.Deployments[i].Namespace+"/"+snapshot.Deployments[i].Name < snapshot.Deployments[j].Namespace+"/"+snapshot.Deployments[j].Name
	})
	sort.Slice(snapshot.StatefulSets, func(i, j int) bool {
		return snapshot.StatefulSets[i].Namespace+"/"+snapshot.StatefulSets[i].Name < snapshot.StatefulSets[j].Namespace+"/"+snapshot.StatefulSets[j].Name
	})
	sort.Slice(snapshot.DaemonSets, func(i, j int) bool {
		return snapshot.DaemonSets[i].Namespace+"/"+snapshot.DaemonSets[i].Name < snapshot.DaemonSets[j].Namespace+"/"+snapshot.DaemonSets[j].Name
	})
	sort.Slice(snapshot.Jobs, func(i, j int) bool {
		return snapshot.Jobs[i].Namespace+"/"+snapshot.Jobs[i].Name < snapshot.Jobs[j].Namespace+"/"+snapshot.Jobs[j].Name
	})
	sort.Slice(snapshot.CronJobs, func(i, j int) bool {
		return snapshot.CronJobs[i].Namespace+"/"+snapshot.CronJobs[i].Name < snapshot.CronJobs[j].Namespace+"/"+snapshot.CronJobs[j].Name
	})
	sort.Slice(snapshot.Services, func(i, j int) bool {
		return snapshot.Services[i].Namespace+"/"+snapshot.Services[i].Name < snapshot.Services[j].Namespace+"/"+snapshot.Services[j].Name
	})
	sort.Slice(snapshot.Ingresses, func(i, j int) bool {
		return snapshot.Ingresses[i].Namespace+"/"+snapshot.Ingresses[i].Name < snapshot.Ingresses[j].Namespace+"/"+snapshot.Ingresses[j].Name
	})
	sort.Slice(snapshot.PersistentVolumeClaims, func(i, j int) bool {
		return snapshot.PersistentVolumeClaims[i].Namespace+"/"+snapshot.PersistentVolumeClaims[i].Name < snapshot.PersistentVolumeClaims[j].Namespace+"/"+snapshot.PersistentVolumeClaims[j].Name
	})
	sort.Slice(snapshot.PersistentVolumes, func(i, j int) bool { return snapshot.PersistentVolumes[i].Name < snapshot.PersistentVolumes[j].Name })
	sort.Slice(snapshot.StorageClasses, func(i, j int) bool { return snapshot.StorageClasses[i].Name < snapshot.StorageClasses[j].Name })
	sort.Slice(snapshot.ConfigMaps, func(i, j int) bool {
		return snapshot.ConfigMaps[i].Namespace+"/"+snapshot.ConfigMaps[i].Name < snapshot.ConfigMaps[j].Namespace+"/"+snapshot.ConfigMaps[j].Name
	})
	sort.Slice(snapshot.Secrets, func(i, j int) bool {
		return snapshot.Secrets[i].Namespace+"/"+snapshot.Secrets[i].Name < snapshot.Secrets[j].Namespace+"/"+snapshot.Secrets[j].Name
	})
	sort.Slice(snapshot.Endpoints, func(i, j int) bool {
		return snapshot.Endpoints[i].Namespace+"/"+snapshot.Endpoints[i].Name < snapshot.Endpoints[j].Namespace+"/"+snapshot.Endpoints[j].Name
	})
	sort.Slice(snapshot.NetworkPolicies, func(i, j int) bool {
		return snapshot.NetworkPolicies[i].Namespace+"/"+snapshot.NetworkPolicies[i].Name < snapshot.NetworkPolicies[j].Namespace+"/"+snapshot.NetworkPolicies[j].Name
	})
	sort.Slice(snapshot.ServiceAccounts, func(i, j int) bool {
		return snapshot.ServiceAccounts[i].Namespace+"/"+snapshot.ServiceAccounts[i].Name < snapshot.ServiceAccounts[j].Namespace+"/"+snapshot.ServiceAccounts[j].Name
	})
	sort.Slice(snapshot.Roles, func(i, j int) bool {
		return snapshot.Roles[i].Namespace+"/"+snapshot.Roles[i].Name < snapshot.Roles[j].Namespace+"/"+snapshot.Roles[j].Name
	})
	sort.Slice(snapshot.RoleBindings, func(i, j int) bool {
		return snapshot.RoleBindings[i].Namespace+"/"+snapshot.RoleBindings[i].Name < snapshot.RoleBindings[j].Namespace+"/"+snapshot.RoleBindings[j].Name
	})
	sort.Slice(snapshot.ClusterRoles, func(i, j int) bool { return snapshot.ClusterRoles[i].Name < snapshot.ClusterRoles[j].Name })
	sort.Slice(snapshot.ClusterRoleBindings, func(i, j int) bool {
		return snapshot.ClusterRoleBindings[i].Name < snapshot.ClusterRoleBindings[j].Name
	})
	sort.Slice(snapshot.HorizontalPodAutoscalers, func(i, j int) bool {
		return snapshot.HorizontalPodAutoscalers[i].Namespace+"/"+snapshot.HorizontalPodAutoscalers[i].Name < snapshot.HorizontalPodAutoscalers[j].Namespace+"/"+snapshot.HorizontalPodAutoscalers[j].Name
	})
	sort.Slice(snapshot.PodDisruptionBudgets, func(i, j int) bool {
		return snapshot.PodDisruptionBudgets[i].Namespace+"/"+snapshot.PodDisruptionBudgets[i].Name < snapshot.PodDisruptionBudgets[j].Namespace+"/"+snapshot.PodDisruptionBudgets[j].Name
	})
	sort.Slice(snapshot.ResourceQuotas, func(i, j int) bool {
		return snapshot.ResourceQuotas[i].Namespace+"/"+snapshot.ResourceQuotas[i].Name < snapshot.ResourceQuotas[j].Namespace+"/"+snapshot.ResourceQuotas[j].Name
	})
	sort.Slice(snapshot.CustomResourceDefinitions, func(i, j int) bool {
		return snapshot.CustomResourceDefinitions[i].Name < snapshot.CustomResourceDefinitions[j].Name
	})
}
