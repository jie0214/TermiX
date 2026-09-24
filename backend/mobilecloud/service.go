package mobilecloud

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jie0214/TermiX/shared/dto"
	"sync"
	"time"
)

type Settings interface {
	GetSettings(context.Context) (dto.AppSettings, error)
	SaveSettings(context.Context, dto.AppSettings) (dto.AppSettings, error)
	ExportMobileSettings(context.Context) (string, error)
}
type Status struct {
	Capability  string `json:"capability"`
	Enabled     bool   `json:"enabled"`
	LastSuccess string `json:"lastSuccess"`
	Error       string `json:"error"`
}
type Service struct {
	gate       sync.Mutex
	mu         sync.Mutex
	state      Status
	settings   Settings
	publish    func(string) string
	capability func() string
}

func NewService(settings Settings, publish func(string) string, capabilities ...func() string) *Service {
	capability := func() string { return "available" }
	if len(capabilities) > 0 {
		capability = capabilities[0]
	}
	return &Service{settings: settings, publish: publish, capability: capability}
}
func (s *Service) Load(ctx context.Context) error {
	s.gate.Lock()
	defer s.gate.Unlock()
	settings, err := s.settings.GetSettings(ctx)
	if err != nil {
		return err
	}
	var enabled bool
	if raw, ok := settings["mobileCloudEnabled"]; ok && json.Unmarshal(raw, &enabled) != nil {
		return errors.New("同步設定無效")
	}
	s.mu.Lock()
	s.state.Enabled = enabled && s.capability() == "available"
	s.mu.Unlock()
	return nil
}
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.state
	state.Capability = s.capability()
	return state
}
func (s *Service) SetEnabled(ctx context.Context, enabled bool) error {
	if enabled && s.capability() != "available" {
		return errors.New("此建置不支援 iCloud 同步")
	}
	s.gate.Lock()
	defer s.gate.Unlock()
	raw, _ := json.Marshal(enabled)
	if _, err := s.settings.SaveSettings(ctx, dto.AppSettings{"mobileCloudEnabled": raw}); err != nil {
		return err
	}
	s.mu.Lock()
	s.state.Enabled = enabled && s.capability() == "available"
	s.state.Error = ""
	s.mu.Unlock()
	return nil
}
func (s *Service) Sync(ctx context.Context) {
	s.gate.Lock()
	defer s.gate.Unlock()
	if s.capability() != "available" || !s.Status().Enabled || ctx.Err() != nil {
		return
	}
	raw, err := s.settings.ExportMobileSettings(ctx)
	result := "invalid"
	if err == nil {
		result = s.publish(raw)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if result == "ok" {
		s.state.LastSuccess = time.Now().UTC().Format(time.RFC3339)
		s.state.Error = ""
	} else {
		s.state.Error = result
	}
}
func (s *Service) Run(ctx context.Context) {
	if err := s.Load(ctx); err != nil {
		s.mu.Lock()
		s.state.Error = "storage"
		s.mu.Unlock()
		return
	}
	s.Sync(ctx)
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.Sync(ctx)
		}
	}
}
