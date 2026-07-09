package app

func (a *App) ConnectTerminal(config SSHConfig) OperationResult {
	return a.terminal.Connect(config)
}

func (a *App) ConnectHostTerminal(request HostConnectionRequest) OperationResult {
	config, err := a.hostVault.ResolveRuntimeConfig(a.contextOrBackground(), request)
	if err != nil {
		return failure(err)
	}
	result := a.terminal.Connect(config)
	// 連線成功後於背景偵測遠端 OS 並寫回 host（輔助功能，失敗一律略過，不影響連線）。
	if result.Success && request.HostID != "" && result.SessionKey != "" {
		go a.detectAndPersistHostOS(request.HostID, result.SessionKey)
	}
	return result
}

// detectAndPersistHostOS 於背景偵測遠端 OS，若與現有值不同則寫回 host.OSID。
func (a *App) detectAndPersistHostOS(hostID string, sessionKey string) {
	osID := a.terminal.DetectOS(sessionKey)
	if osID == "" {
		return
	}
	ctx := a.contextOrBackground()
	host, err := a.hostVault.GetHost(ctx, hostID)
	if err != nil || host.OSID == osID {
		return
	}
	host.OSID = osID
	if _, _, err := a.hostVault.SaveHost(ctx, SaveHostRequest{Host: host}); err != nil {
		return
	}
}

func (a *App) CancelConnectHostTerminal(request HostConnectionRequest) OperationResult {
	config, err := a.hostVault.ResolveRuntimeConfig(a.contextOrBackground(), request)
	if err != nil {
		return failure(err)
	}
	a.terminal.CancelConnect(config)
	return success("canceled")
}

func (a *App) StartLocalTerminal(shellPath string) OperationResult {
	return a.terminal.StartLocal(shellPath)
}

func (a *App) ListKnownHosts() OperationResult {
	entries, err := a.sshConnector.ListKnownHosts()
	if err != nil {
		return failure(err)
	}
	return successJSON(entries)
}

func (a *App) RemoveKnownHost(host string, port int) OperationResult {
	err := a.sshConnector.RemoveKnownHost(host, port)
	if err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	return OperationResult{Success: true}
}

// ConfirmUnknownHostKey 由前端在使用者確認未知主機指紋後呼叫，
// 將該主機公鑰寫入 known_hosts。host 與 port 必須與連線時相同。
func (a *App) ConfirmUnknownHostKey(host string, port int) OperationResult {
	if err := a.sshConnector.ConfirmUnknownHost(host, port); err != nil {
		return OperationResult{Success: false, Error: err.Error()}
	}
	return OperationResult{Success: true}
}

func (a *App) CancelConnectTerminal(config SSHConfig) {
	a.terminal.CancelConnect(config)
}

func (a *App) ExecuteSessionCommand(sessionKey string, command string) OperationResult {
	return a.terminal.ExecuteCommand(sessionKey, command)
}

func (a *App) ExecuteSessionCommandIsolated(sessionKey string, command string) OperationResult {
	return a.terminal.ExecuteIsolated(sessionKey, command)
}

func (a *App) GetAutocompleteSuggestions(sessionKey string, fullCommand string) AutocompleteResult {
	return a.terminal.Autocomplete(sessionKey, fullCommand)
}

func (a *App) CloseTerminalSession(sessionKey string) {
	a.terminal.Close(sessionKey)
}

func (a *App) ResizeTerminal(sessionKey string, cols int, rows int) OperationResult {
	return a.terminal.Resize(sessionKey, cols, rows)
}

func (a *App) WriteTerminalInput(sessionKey string, data string) {
	a.terminal.WriteInput(sessionKey, data)
}

func (a *App) ExecuteLocalCommand(command string, env map[string]string) OperationResult {
	return a.controlPanel.ExecuteLocalCommand(command, env)
}

func (a *App) ExecuteTerminalCommand(request TerminalCommandRequest) OperationResult {
	return a.terminal.ExecuteTerminalCommand(request.SSH, request.Command)
}
