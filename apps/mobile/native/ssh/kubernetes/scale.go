package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"net/http"
)

type scaleValue struct {
	UID             string `json:"uid"`
	ResourceVersion string `json:"resourceVersion"`
	Replicas        *int32 `json:"replicas"`
}
type scaleDocument struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Metadata   struct {
		Name            string `json:"name"`
		Namespace       string `json:"namespace"`
		UID             string `json:"uid"`
		ResourceVersion string `json:"resourceVersion"`
	} `json:"metadata"`
	Spec struct {
		Replicas *int32 `json:"replicas"`
	} `json:"spec"`
}

func validScale(value scaleValue) bool {
	return value.UID != "" && len(value.UID) <= 256 && value.ResourceVersion != "" && len(value.ResourceVersion) <= 256 && value.Replicas != nil && *value.Replicas >= 0
}
func scaleRequest(raw, namespace, kind, name string, body []byte) (string, error) {
	if (kind != "deployments" && kind != "statefulsets") || !validResourceName(name) {
		return "", errors.New("invalid_resource")
	}
	options := apiRequest{apiPath: "apis/apps/v1", resource: kind, name: name, subresource: "scale", maxBytes: 65536, body: body}
	if body != nil {
		options.method = http.MethodPut
	}
	result, err := requestAPI(raw, namespace, options)
	if err != nil {
		// 寫入開始後的傳輸／伺服器失敗不能宣稱未生效，也不可自動重送。
		if body != nil && (err.Error() == "connection_failed" || err.Error() == "api_failed") {
			return "", errors.New("scale_unknown")
		}
		return "", err
	}
	var doc scaleDocument
	value := scaleValue{}
	if len(result) <= 65536 && json.Unmarshal(result, &doc) == nil {
		value = scaleValue{doc.Metadata.UID, doc.Metadata.ResourceVersion, doc.Spec.Replicas}
	}
	if doc.APIVersion != "autoscaling/v1" || doc.Kind != "Scale" || doc.Metadata.Name != name || doc.Metadata.Namespace != namespace || !validScale(value) {
		if body != nil {
			return "", errors.New("scale_unknown")
		}
		return "", errors.New("api_failed")
	}
	encoded, _ := json.Marshal(value)
	return string(encoded), nil
}

// GetScale 重新取得目前期望副本與更新條件，不使用清單快取。
func GetScale(raw, namespace, kind, name string) (string, error) {
	return scaleRequest(raw, namespace, kind, name, nil)
}

// UpdateScale 只更新 scale，保留使用者確認時的 UID 與 resourceVersion。
func UpdateScale(raw, namespace, kind, name, payload string) (string, error) {
	var value scaleValue
	if len(payload) > 2048 || json.Unmarshal([]byte(payload), &value) != nil || !validScale(value) {
		return "", errors.New("invalid_scale")
	}
	var doc scaleDocument
	doc.APIVersion = "autoscaling/v1"
	doc.Kind = "Scale"
	doc.Metadata.Name = name
	doc.Metadata.Namespace = namespace
	doc.Metadata.UID = value.UID
	doc.Metadata.ResourceVersion = value.ResourceVersion
	doc.Spec.Replicas = value.Replicas
	body, _ := json.Marshal(doc)
	result, err := scaleRequest(raw, namespace, kind, name, body)
	if err != nil {
		return "", err
	}
	var accepted scaleValue
	if json.Unmarshal([]byte(result), &accepted) != nil || accepted.UID != value.UID {
		return "", errors.New("scale_unknown")
	}
	return result, nil
}
