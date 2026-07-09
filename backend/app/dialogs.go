package app

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/yaml.v3"
)

const maxKubernetesResourceYAMLBytes = 1024 * 1024

func (a *App) SelectFile(title string) (string, error) {
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: title,
	})
}

func (a *App) SaveJSONFile(defaultFilename string, content string) OperationResult {
	filename := strings.TrimSpace(defaultFilename)
	if filename == "" {
		filename = "termix-export.json"
	}
	if !strings.HasSuffix(strings.ToLower(filename), ".json") {
		filename += ".json"
	}

	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "匯出 TermiX JSON 設定",
		DefaultFilename: filename,
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "JSON Files (*.json)",
				Pattern:     "*.json",
			},
		},
	})
	if err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	if strings.TrimSpace(path) == "" {
		return OperationResult{Success: false, Error: "已取消匯出"}
	}
	if !strings.HasSuffix(strings.ToLower(path), ".json") {
		path += ".json"
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	return OperationResult{Success: true, Output: path}
}

func (a *App) SaveKubernetesResourceYAML(defaultFilename string, content string) (string, error) {
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("Kubernetes Resource YAML 不可為空")
	}
	if len(content) > maxKubernetesResourceYAMLBytes {
		return "", fmt.Errorf("Kubernetes Resource YAML 不可超過 1 MiB")
	}
	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "儲存 Kubernetes Resource YAML",
		DefaultFilename: normalizeYAMLFilename(defaultFilename),
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "YAML Files (*.yaml; *.yml)", Pattern: "*.yaml;*.yml"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("開啟 YAML 儲存視窗失敗")
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return "", nil
	}
	if !hasYAMLExtension(path) {
		path += ".yaml"
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		return "", fmt.Errorf("儲存 Kubernetes Resource YAML 失敗")
	}
	return path, nil
}

const maxKubernetesPodLogsBytes = 8 * 1024 * 1024

// SaveKubernetesPodLogs 跳出儲存對話框並將 Pod Logs 內容寫入使用者選擇的位置。
// WKWebView 對 <a download> 支援不佳（常無反應），故走 Wails 原生存檔對話框。
func (a *App) SaveKubernetesPodLogs(defaultFilename string, content string) (string, error) {
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("Pod Logs 不可為空")
	}
	if len(content) > maxKubernetesPodLogsBytes {
		return "", fmt.Errorf("Pod Logs 內容過大")
	}
	filename := strings.TrimSpace(defaultFilename)
	if filename == "" {
		filename = "pod-logs.log"
	}
	if !hasLogExtension(filename) {
		filename += ".log"
	}
	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "儲存 Pod Logs",
		DefaultFilename: filename,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Log Files (*.log; *.txt)", Pattern: "*.log;*.txt"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("開啟 Logs 儲存視窗失敗")
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return "", nil
	}
	if !hasLogExtension(path) {
		path += ".log"
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		return "", fmt.Errorf("儲存 Pod Logs 失敗")
	}
	return path, nil
}

func hasLogExtension(filename string) bool {
	lower := strings.ToLower(strings.TrimSpace(filename))
	return strings.HasSuffix(lower, ".log") || strings.HasSuffix(lower, ".txt")
}

func normalizeYAMLFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "kubernetes-resource.yaml"
	}
	if !hasYAMLExtension(filename) {
		filename += ".yaml"
	}
	return filename
}

func hasYAMLExtension(filename string) bool {
	lowerFilename := strings.ToLower(strings.TrimSpace(filename))
	return strings.HasSuffix(lowerFilename, ".yaml") || strings.HasSuffix(lowerFilename, ".yml")
}

func (a *App) ReadJSONFile(path string) OperationResult {
	if strings.TrimSpace(path) == "" {
		return OperationResult{Success: false, Error: "檔案路徑為空"}
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	return OperationResult{Success: true, Output: string(bytes)}
}

// SaveBackupFile 支援將前端的 JSON 設定資料儲存為 JSON 或 YAML 格式。
func (a *App) SaveBackupFile(defaultFilename string, jsonContent string, format string) OperationResult {
	filename := strings.TrimSpace(defaultFilename)
	if filename == "" {
		filename = "termix-backup"
	}

	var pattern string
	var displayName string
	format = strings.ToLower(strings.TrimSpace(format))

	if format == "yaml" {
		pattern = "*.yaml;*.yml"
		displayName = "YAML Files (*.yaml; *.yml)"
		// 若預設檔名沒有對應副檔名，清除舊副檔名並加上 .yaml
		if strings.HasSuffix(strings.ToLower(filename), ".json") {
			filename = filename[:len(filename)-5]
		}
		if !strings.HasSuffix(strings.ToLower(filename), ".yaml") && !strings.HasSuffix(strings.ToLower(filename), ".yml") {
			filename += ".yaml"
		}
	} else {
		pattern = "*.json"
		displayName = "JSON Files (*.json)"
		// 若預設檔名有 yaml 副檔名，清除它並加上 .json
		if strings.HasSuffix(strings.ToLower(filename), ".yaml") {
			filename = filename[:len(filename)-5]
		} else if strings.HasSuffix(strings.ToLower(filename), ".yml") {
			filename = filename[:len(filename)-4]
		}
		if !strings.HasSuffix(strings.ToLower(filename), ".json") {
			filename += ".json"
		}
	}

	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "匯出 TermiX 備份設定",
		DefaultFilename: filename,
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: displayName,
				Pattern:     pattern,
			},
		},
	})
	if err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	if strings.TrimSpace(path) == "" {
		return OperationResult{Success: false, Error: "已取消匯出"}
	}

	var finalContent string
	lowerPath := strings.ToLower(path)
	if strings.HasSuffix(lowerPath, ".yaml") || strings.HasSuffix(lowerPath, ".yml") || format == "yaml" {
		if !strings.HasSuffix(lowerPath, ".yaml") && !strings.HasSuffix(lowerPath, ".yml") {
			path += ".yaml"
		}
		var data interface{}
		if err := json.Unmarshal([]byte(jsonContent), &data); err != nil {
			return OperationResult{Success: false, Error: "解析 JSON 資料失敗: " + err.Error()}
		}
		yamlBytes, err := yaml.Marshal(data)
		if err != nil {
			return OperationResult{Success: false, Error: "轉換為 YAML 失敗: " + err.Error()}
		}
		finalContent = string(yamlBytes)
	} else {
		if !strings.HasSuffix(lowerPath, ".json") {
			path += ".json"
		}
		finalContent = jsonContent
	}

	if err := os.WriteFile(path, []byte(finalContent), 0600); err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	return OperationResult{Success: true, Output: path}
}

// ReadBackupFile 支援載入 JSON 或 YAML 備份檔案，並統一轉換為 JSON 回傳給前端。
func (a *App) ReadBackupFile(format string) OperationResult {
	var pattern string
	var displayName string
	format = strings.ToLower(strings.TrimSpace(format))

	if format == "yaml" {
		pattern = "*.yaml;*.yml"
		displayName = "YAML Files (*.yaml; *.yml)"
	} else if format == "json" {
		pattern = "*.json"
		displayName = "JSON Files (*.json)"
	} else {
		pattern = "*.json;*.yaml;*.yml"
		displayName = "JSON/YAML Backup Files (*.json; *.yaml; *.yml)"
	}

	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "選擇 TermiX 備份設定檔案",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: displayName,
				Pattern:     pattern,
			},
		},
	})
	if err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	if strings.TrimSpace(path) == "" {
		return OperationResult{Success: false, Error: "已取消匯入"}
	}

	bytes, err := os.ReadFile(path)
	if err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}

	lowerPath := strings.ToLower(path)
	var jsonStr string

	if strings.HasSuffix(lowerPath, ".yaml") || strings.HasSuffix(lowerPath, ".yml") {
		var data interface{}
		if err := yaml.Unmarshal(bytes, &data); err != nil {
			return OperationResult{Success: false, Error: "解析 YAML 檔案失敗: " + err.Error()}
		}
		data = convertBackupMap(data)
		jsonBytes, err := json.Marshal(data)
		if err != nil {
			return OperationResult{Success: false, Error: "轉換為 JSON 失敗: " + err.Error()}
		}
		jsonStr = string(jsonBytes)
	} else {
		var temp interface{}
		if err := json.Unmarshal(bytes, &temp); err != nil {
			return OperationResult{Success: false, Error: "解析 JSON 檔案失敗: " + err.Error()}
		}
		jsonStr = string(bytes)
	}

	return OperationResult{Success: true, Output: jsonStr}
}

// convertBackupMap 遞迴將 map[interface{}]interface{} 轉換為 map[string]interface{}，確保 JSON 編碼成功。
func convertBackupMap(i interface{}) interface{} {
	switch x := i.(type) {
	case map[interface{}]interface{}:
		m2 := map[string]interface{}{}
		for k, v := range x {
			m2[fmt.Sprint(k)] = convertBackupMap(v)
		}
		return m2
	case []interface{}:
		for idx, v := range x {
			x[idx] = convertBackupMap(v)
		}
	case map[string]interface{}:
		for k, v := range x {
			x[k] = convertBackupMap(v)
		}
	}
	return i
}
