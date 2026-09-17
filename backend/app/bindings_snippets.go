package app

import "errors"

func (a *App) ListSnippets() ([]Snippet, error) {
	return a.snippets.ListSnippets()
}

func (a *App) CreateSnippet(request SnippetUpsertRequest) (Snippet, error) {
	return a.snippets.CreateSnippet(request)
}

func (a *App) UpdateSnippet(request SnippetUpsertRequest) (Snippet, error) {
	return a.snippets.UpdateSnippet(request)
}

func (a *App) DeleteSnippet(id string) error {
	return a.snippets.DeleteSnippet(id)
}

func (a *App) GetHostStartupSnippet(config SSHConfig) (HostStartupSnippet, error) {
	return a.snippets.GetHostStartupSnippet(config)
}

func (a *App) SetHostStartupSnippet(request HostStartupSnippetRequest) (HostStartupSnippet, error) {
	return a.snippets.SetHostStartupSnippet(request)
}

func (a *App) ExecuteSnippetBatch(request ExecuteSnippetBatchRequest) (SnippetBatchResult, error) {
	if !a.beginOperation() {
		return SnippetBatchResult{}, errors.New("正在準備結束或更新，請稍後再試。")
	}
	defer a.endOperation()
	return a.snippets.ExecuteSnippetBatch(request)
}
