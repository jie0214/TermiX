package mobilessh

import "github.com/jie0214/TermiX/mobile/ssh/kubernetes"

func InspectKubeconfig(raw string) (string, error) { return mobilekubernetes.Inspect(raw) }
func ListKubePods(raw, namespace string) (string, error) {
	return mobilekubernetes.ListPods(raw, namespace)
}

func ListKubeResources(raw, namespace, kind string) (string, error) {
	return mobilekubernetes.ListResources(raw, namespace, kind)
}
func GetKubeConfigMap(raw, namespace, name string) (string, error) {
	return mobilekubernetes.GetConfigMap(raw, namespace, name)
}

func GetKubePodContainers(raw, namespace, name string) (string, error) {
	return mobilekubernetes.GetPodContainers(raw, namespace, name)
}
func GetKubePodLogs(raw, namespace, name, container string, previous bool) (string, error) {
	return mobilekubernetes.GetPodLogs(raw, namespace, name, container, previous)
}

func GetKubeScale(raw, namespace, kind, name string) (string, error) {
	return mobilekubernetes.GetScale(raw, namespace, kind, name)
}
func UpdateKubeScale(raw, namespace, kind, name, payload string) (string, error) {
	return mobilekubernetes.UpdateScale(raw, namespace, kind, name, payload)
}

func GetKubePodMetrics(raw, namespace, name string) (string, error) {
	return mobilekubernetes.GetPodMetrics(raw, namespace, name)
}

func LoginAWS(region, credentials string) (string, error) {
	return mobilekubernetes.LoginAWS(region, credentials)
}
func AuthorizeEKS(raw, credentials string) (string, error) {
	return mobilekubernetes.AuthorizeEKS(raw, credentials)
}

func AWSProfileKey(region, profile string) (string, error) {
	return mobilekubernetes.AWSProfileKey(region, profile)
}

func InspectKubeContexts(raw string) (string, error) { return mobilekubernetes.InspectContexts(raw) }
func SelectKubeContext(raw, name string) (string, error) {
	return mobilekubernetes.SelectContext(raw, name)
}

func SelectKubeAWSProfile(raw, name string) (string, error) {
	return mobilekubernetes.SelectAWSProfile(raw, name)
}
func ListKubeNamespaces(raw, cursor string) (string, error) {
	return mobilekubernetes.ListNamespaces(raw, cursor)
}

func ListKubePodMetrics(raw, namespace string) (string, error) {
	return mobilekubernetes.ListPodMetrics(raw, namespace)
}
