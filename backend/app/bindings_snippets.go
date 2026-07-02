package app

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
	return a.snippets.ExecuteSnippetBatch(request)
}
