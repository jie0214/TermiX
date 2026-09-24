package app

func (a *App) ExportMobileSettings() OperationResult {
	raw, err := a.hostVault.ExportMobileSettings(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return success(raw)
}
func (a *App) GetMobileSyncStatus() OperationResult { return successJSON(a.mobileCloud.Status()) }
func (a *App) SetMobileCloudEnabled(enabled bool) OperationResult {
	if err := a.mobileCloud.SetEnabled(a.contextOrBackground(), enabled); err != nil {
		return failure(err)
	}
	if enabled {
		a.mobileCloud.Sync(a.contextOrBackground())
	}
	return successJSON(a.mobileCloud.Status())
}
func (a *App) SyncMobileSettings() OperationResult {
	a.mobileCloud.Sync(a.contextOrBackground())
	return successJSON(a.mobileCloud.Status())
}
