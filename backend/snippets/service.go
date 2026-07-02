package snippets

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"github.com/jie0214/TermiX/backend/common"
	"github.com/jie0214/TermiX/backend/terminal"
	"github.com/jie0214/TermiX/shared/dto"
	"strconv"
	"strings"
	"sync"
	"time"
)

var log = common.DomainLogger("snippets")

type executor interface {
	ExecuteSnippet(config dto.SSHConfig, script string) dto.OperationResult
}

type terminalExecutor struct {
	terminal *terminal.Manager
}

func (e terminalExecutor) ExecuteSnippet(config dto.SSHConfig, script string) dto.OperationResult {
	if e.terminal == nil {
		return dto.OperationResult{Success: false, Error: "snippet terminal executor 尚未初始化"}
	}

	connectResult := e.terminal.Connect(config)
	if !connectResult.Success {
		return connectResult
	}
	if strings.TrimSpace(connectResult.SessionKey) == "" {
		return dto.OperationResult{Success: false, Error: "無法建立 Snippet 執行所需的 Terminal session"}
	}

	createdHiddenSession := strings.TrimSpace(connectResult.Output) != ""
	if createdHiddenSession {
		defer e.terminal.Close(connectResult.SessionKey)
	}

	return e.terminal.ExecuteIsolated(connectResult.SessionKey, script)
}

type snapshot struct {
	Snippets        []dto.Snippet            `json:"snippets"`
	HostPreferences []dto.HostStartupSnippet `json:"hostPreferences"`
}

type Service struct {
	mu       sync.Mutex
	store    string
	storeErr error
	executor executor
	now      func() time.Time
}

func NewService(termMgr *terminal.Manager) *Service {
	store, err := defaultStorePath()
	return &Service{
		store:    store,
		storeErr: err,
		executor: terminalExecutor{terminal: termMgr},
		now:      time.Now,
	}
}

func newServiceForTest(store string, exec executor, now func() time.Time) *Service {
	return &Service{
		store:    store,
		executor: exec,
		now:      now,
	}
}

func (s *Service) ListSnippets() ([]dto.Snippet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return nil, err
	}

	result := make([]dto.Snippet, len(data.Snippets))
	copy(result, data.Snippets)
	return result, nil
}

func (s *Service) CreateSnippet(request dto.SnippetUpsertRequest) (dto.Snippet, error) {
	normalized, err := normalizeSnippetRequest(request, false)
	if err != nil {
		return dto.Snippet{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return dto.Snippet{}, err
	}

	now := s.now().UTC().Format(time.RFC3339)
	snippet := dto.Snippet{
		ID:          newSnippetID(s.now()),
		Name:        normalized.Name,
		Description: normalized.Description,
		Script:      normalized.Script,
		Package:     normalized.Package,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	data.Snippets = append(data.Snippets, snippet)

	if err := s.saveLocked(data); err != nil {
		return dto.Snippet{}, err
	}

	log.WithField("snippetId", snippet.ID).Info("建立 snippet")
	return snippet, nil
}

func (s *Service) UpdateSnippet(request dto.SnippetUpsertRequest) (dto.Snippet, error) {
	normalized, err := normalizeSnippetRequest(request, true)
	if err != nil {
		return dto.Snippet{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return dto.Snippet{}, err
	}

	for idx := range data.Snippets {
		if data.Snippets[idx].ID != normalized.ID {
			continue
		}

		data.Snippets[idx].Name = normalized.Name
		data.Snippets[idx].Description = normalized.Description
		data.Snippets[idx].Script = normalized.Script
		data.Snippets[idx].Package = normalized.Package
		data.Snippets[idx].UpdatedAt = s.now().UTC().Format(time.RFC3339)

		if err := s.saveLocked(data); err != nil {
			return dto.Snippet{}, err
		}

		log.WithField("snippetId", normalized.ID).Info("更新 snippet")
		return data.Snippets[idx], nil
	}

	return dto.Snippet{}, fmt.Errorf("snippet 不存在：%s", normalized.ID)
}

func (s *Service) DeleteSnippet(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("snippet id 不可空白")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return err
	}

	found := false
	filtered := make([]dto.Snippet, 0, len(data.Snippets))
	for _, snippet := range data.Snippets {
		if snippet.ID == id {
			found = true
			continue
		}
		filtered = append(filtered, snippet)
	}
	if !found {
		return fmt.Errorf("snippet 不存在：%s", id)
	}

	cleanPrefs := make([]dto.HostStartupSnippet, 0, len(data.HostPreferences))
	for _, pref := range data.HostPreferences {
		if pref.StartupSnippetID == id {
			continue
		}
		cleanPrefs = append(cleanPrefs, pref)
	}

	data.Snippets = filtered
	data.HostPreferences = cleanPrefs

	if err := s.saveLocked(data); err != nil {
		return err
	}

	log.WithField("snippetId", id).Info("刪除 snippet")
	return nil
}

func (s *Service) GetHostStartupSnippet(config dto.SSHConfig) (dto.HostStartupSnippet, error) {
	hostKey, err := stableHostKey(config)
	if err != nil {
		return dto.HostStartupSnippet{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return dto.HostStartupSnippet{}, err
	}

	for _, pref := range data.HostPreferences {
		if pref.HostKey == hostKey {
			return pref, nil
		}
	}

	return dto.HostStartupSnippet{HostKey: hostKey}, nil
}

func (s *Service) SetHostStartupSnippet(request dto.HostStartupSnippetRequest) (dto.HostStartupSnippet, error) {
	hostKey, err := stableHostKey(request.SSH)
	if err != nil {
		return dto.HostStartupSnippet{}, err
	}

	targetSnippetID := strings.TrimSpace(request.StartupSnippetID)

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return dto.HostStartupSnippet{}, err
	}

	if targetSnippetID != "" && !containsSnippet(data.Snippets, targetSnippetID) {
		return dto.HostStartupSnippet{}, fmt.Errorf("startup snippet 不存在：%s", targetSnippetID)
	}

	nextPrefs := make([]dto.HostStartupSnippet, 0, len(data.HostPreferences))
	current := dto.HostStartupSnippet{HostKey: hostKey}
	for _, pref := range data.HostPreferences {
		if pref.HostKey == hostKey {
			continue
		}
		nextPrefs = append(nextPrefs, pref)
	}
	if targetSnippetID != "" {
		current.StartupSnippetID = targetSnippetID
		nextPrefs = append(nextPrefs, current)
	}

	data.HostPreferences = nextPrefs
	if err := s.saveLocked(data); err != nil {
		return dto.HostStartupSnippet{}, err
	}

	log.WithFields(map[string]interface{}{
		"hostKey":          hostKey,
		"startupSnippetId": current.StartupSnippetID,
	}).Info("更新 host startup snippet")
	return current, nil
}

func (s *Service) ExecuteSnippetBatch(request dto.ExecuteSnippetBatchRequest) (dto.SnippetBatchResult, error) {
	snippetID := strings.TrimSpace(request.SnippetID)
	if snippetID == "" {
		return dto.SnippetBatchResult{}, errors.New("snippet id 不可空白")
	}
	if len(request.Targets) == 0 {
		return dto.SnippetBatchResult{}, errors.New("批次執行至少需要一個 target")
	}
	if s.executor == nil {
		return dto.SnippetBatchResult{}, errors.New("snippet executor 尚未初始化")
	}

	s.mu.Lock()
	data, err := s.loadLocked()
	s.mu.Unlock()
	if err != nil {
		return dto.SnippetBatchResult{}, err
	}

	var snippet *dto.Snippet
	for idx := range data.Snippets {
		if data.Snippets[idx].ID == snippetID {
			snippet = &data.Snippets[idx]
			break
		}
	}
	if snippet == nil {
		return dto.SnippetBatchResult{}, fmt.Errorf("snippet 不存在：%s", snippetID)
	}

	results := make([]dto.SnippetExecutionItemResult, 0, len(request.Targets))
	allSuccess := true
	for _, target := range request.Targets {
		hostKey, keyErr := stableHostKey(target.SSH)
		if keyErr != nil {
			allSuccess = false
			results = append(results, dto.SnippetExecutionItemResult{
				HostKey: "",
				Success: false,
				Error:   keyErr.Error(),
			})
			continue
		}

		execResult := s.executor.ExecuteSnippet(target.SSH, snippet.Script)
		if !execResult.Success {
			allSuccess = false
		}
		results = append(results, dto.SnippetExecutionItemResult{
			HostKey: hostKey,
			Success: execResult.Success,
			Output:  execResult.Output,
			Error:   execResult.Error,
		})
	}

	return dto.SnippetBatchResult{
		Success: allSuccess,
		Results: results,
	}, nil
}

func (s *Service) loadLocked() (snapshot, error) {
	if s.storeErr != nil {
		return snapshot{}, s.storeErr
	}
	if strings.TrimSpace(s.store) == "" {
		return snapshot{}, errors.New("snippet store path 不可空白")
	}

	bytes, err := os.ReadFile(s.store)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return snapshot{}, nil
		}
		log.WithError(err).WithField("path", s.store).Error("讀取 snippet store 失敗")
		return snapshot{}, fmt.Errorf("讀取 snippet store 失敗：%w", err)
	}
	if len(bytes) == 0 {
		return snapshot{}, nil
	}

	var data snapshot
	if err := json.Unmarshal(bytes, &data); err != nil {
		log.WithError(err).WithField("path", s.store).Error("解析 snippet store 失敗")
		return snapshot{}, fmt.Errorf("解析 snippet store 失敗：%w", err)
	}
	if data.Snippets == nil {
		data.Snippets = []dto.Snippet{}
	}
	if data.HostPreferences == nil {
		data.HostPreferences = []dto.HostStartupSnippet{}
	}
	return data, nil
}

func (s *Service) saveLocked(data snapshot) error {
	if s.storeErr != nil {
		return s.storeErr
	}
	if strings.TrimSpace(s.store) == "" {
		return errors.New("snippet store path 不可空白")
	}

	if err := os.MkdirAll(filepath.Dir(s.store), 0700); err != nil {
		log.WithError(err).WithField("path", s.store).Error("建立 snippet store 目錄失敗")
		return fmt.Errorf("建立 snippet store 目錄失敗：%w", err)
	}

	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 snippet store 失敗：%w", err)
	}

	tmpPath := s.store + ".tmp"
	if err := os.WriteFile(tmpPath, bytes, 0600); err != nil {
		log.WithError(err).WithField("path", tmpPath).Error("寫入 snippet store 暫存檔失敗")
		return fmt.Errorf("寫入 snippet store 失敗：%w", err)
	}
	if err := os.Rename(tmpPath, s.store); err != nil {
		log.WithError(err).WithFields(map[string]interface{}{
			"from": tmpPath,
			"to":   s.store,
		}).Error("原子更新 snippet store 失敗")
		return fmt.Errorf("更新 snippet store 失敗：%w", err)
	}
	return nil
}

func defaultStorePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		homeDir, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", fmt.Errorf("無法解析 snippets 設定目錄：%w", err)
		}
		return filepath.Join(homeDir, ".termix", "snippets.json"), nil
	}
	return filepath.Join(configDir, "TermiX", "snippets.json"), nil
}

func normalizeSnippetRequest(request dto.SnippetUpsertRequest, requireID bool) (dto.SnippetUpsertRequest, error) {
	request.ID = strings.TrimSpace(request.ID)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Package = strings.TrimSpace(request.Package)

	if requireID && request.ID == "" {
		return dto.SnippetUpsertRequest{}, errors.New("snippet id 不可空白")
	}
	if request.Name == "" {
		return dto.SnippetUpsertRequest{}, errors.New("snippet 名稱不可空白")
	}
	if strings.TrimSpace(request.Script) == "" {
		return dto.SnippetUpsertRequest{}, errors.New("snippet script 不可空白")
	}
	return request, nil
}

func stableHostKey(config dto.SSHConfig) (string, error) {
	host := strings.TrimSpace(config.Host)
	username := strings.TrimSpace(config.Username)
	authMode := strings.TrimSpace(config.AuthMode)
	privateKeyPath := strings.TrimSpace(config.PrivateKeyPath)
	certPath := strings.TrimSpace(config.CertPath)

	if host == "" {
		return "", errors.New("host 不可空白")
	}
	if config.Port < 1 || config.Port > 65535 {
		return "", errors.New("host port 必須介於 1 到 65535")
	}
	if username == "" {
		return "", errors.New("host username 不可空白")
	}
	if authMode == "" {
		return "", errors.New("host authMode 不可空白")
	}

	return strings.Join([]string{
		host,
		strconv.Itoa(config.Port),
		username,
		authMode,
		privateKeyPath,
		certPath,
	}, "|"), nil
}

func containsSnippet(snippets []dto.Snippet, id string) bool {
	for _, snippet := range snippets {
		if snippet.ID == id {
			return true
		}
	}
	return false
}

func newSnippetID(now time.Time) string {
	return "snippet_" + strconv.FormatInt(now.UTC().UnixNano(), 10)
}
