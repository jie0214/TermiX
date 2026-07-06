package app

func (a *App) ListKeychainKeys() OperationResult {
	keys, err := a.keychain.List(a.contextOrBackground())
	if err != nil {
		return failure(err)
	}
	return successJSON(keys)
}

func (a *App) GenerateKeychainKey(request GenerateKeychainKeyRequest) OperationResult {
	key, err := a.keychain.Generate(a.contextOrBackground(), request)
	if err != nil {
		return failure(err)
	}
	return successJSON(key)
}

func (a *App) ImportKeychainKey(request ImportKeychainKeyRequest) OperationResult {
	key, err := a.keychain.Import(a.contextOrBackground(), request)
	if err != nil {
		return failure(err)
	}
	return successJSON(key)
}

func (a *App) DeleteKeychainKey(keyID string) OperationResult {
	if err := a.keychain.Delete(a.contextOrBackground(), keyID); err != nil {
		return failure(err)
	}
	return success("deleted")
}

func (a *App) ExportKeychainKey(request ExportKeychainKeyRequest) OperationResult {
	exported, err := a.keychain.Export(a.contextOrBackground(), request)
	if err != nil {
		return failure(err)
	}
	return successJSON(exported)
}
