package dto

// AIConnection 僅包含本機程式資訊與 TermiX 的連線選擇，不傳遞 Agent 憑證。
type AIConnection struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Installed bool   `json:"installed"`
	Connected bool   `json:"connected"`
}

type AIModel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type AIAnalysisMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type PodAnalysisRequest struct {
	Locale        string              `json:"locale,omitempty"`
	Messages      []AIAnalysisMessage `json:"messages,omitempty"`
	RequestID     string              `json:"requestId"`
	AgentID       string              `json:"agentId"`
	ModelID       string              `json:"modelId"`
	ConnectedAt   string              `json:"connectedAt"`
	Namespace     string              `json:"namespace"`
	PodName       string              `json:"podName"`
	PodUID        string              `json:"podUid"`
	Container     string              `json:"container"`
	IncludeLogs   bool                `json:"includeLogs"`
	IncludeEvents bool                `json:"includeEvents"`
}

type PodAnalysisEvidence struct {
	Title     string `json:"title"`
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
}

type PodAnalysisSnapshot struct {
	EventName  string                `json:"eventName,omitempty"`
	EventUID   string                `json:"eventUid,omitempty"`
	Namespace  string                `json:"namespace"`
	PodName    string                `json:"podName"`
	PodUID     string                `json:"podUid"`
	CapturedAt string                `json:"capturedAt"`
	Evidence   []PodAnalysisEvidence `json:"evidence"`
	Warnings   []string              `json:"warnings"`
}

type PodAnalysisResult struct {
	AgentID  string              `json:"agentId"`
	ModelID  string              `json:"modelId"`
	Text     string              `json:"text"`
	Snapshot PodAnalysisSnapshot `json:"snapshot"`
}

// EventAnalysisRequest 以事件 UID 固定分析目標，不接受前端傳入的事件內容。
type EventAnalysisRequest struct {
	Locale      string              `json:"locale,omitempty"`
	Messages    []AIAnalysisMessage `json:"messages,omitempty"`
	RequestID   string              `json:"requestId"`
	AgentID     string              `json:"agentId"`
	ModelID     string              `json:"modelId"`
	ConnectedAt string              `json:"connectedAt"`
	Namespace   string              `json:"namespace"`
	EventName   string              `json:"eventName"`
	EventUID    string              `json:"eventUid"`
}
