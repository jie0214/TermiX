package mobilekubernetes

import (
	"encoding/json"
	"errors"
	"net/http"
)

// DeleteResource 保留使用者確認時的身分與版本，避免刪除同名重建資源。
func DeleteResource(raw, namespace, kind, name, payload string) (string, error) {
	if readOnlyResource(kind) {
		return "", errors.New("api_rejected")
	}
	route, _ := documentRoute(kind)
	var identity struct {
		UID             string `json:"uid"`
		ResourceVersion string `json:"resourceVersion"`
	}
	if route == "" || !validResourceName(name) || len(payload) > 2048 || json.Unmarshal([]byte(payload), &identity) != nil || identity.UID == "" || identity.ResourceVersion == "" {
		return "", errors.New("invalid_resource")
	}
	body, _ := json.Marshal(map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "propagationPolicy": "Background", "preconditions": identity})
	result, err := requestAPI(raw, namespace, apiRequest{apiPath: route, resource: kind, name: name, method: http.MethodDelete, body: body, maxBytes: documentLimit})
	if err != nil {
		if err.Error() == "connection_failed" || err.Error() == "api_failed" {
			return "", errors.New("delete_unknown")
		}
		return "", err
	}
	if len(result) > 0 {
		var response map[string]any
		if json.Unmarshal(result, &response) != nil {
			return "", errors.New("delete_unknown")
		}
		if response["kind"] == "Status" {
			if response["status"] != "Success" {
				return "", errors.New("delete_unknown")
			}
		} else if !checkDocument(response, namespace, kind, name) || stringField(object(response["metadata"]), "uid") != identity.UID {
			return "", errors.New("delete_unknown")
		}
	}
	return `{"accepted":true}`, nil
}
