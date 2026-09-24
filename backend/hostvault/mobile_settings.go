package hostvault

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jie0214/TermiX/shared/dto"
	"github.com/jie0214/TermiX/shared/mobilesettings"
	"strings"
)

// ExportMobileSettings 不讀取機密儲存，不沿用包含腳本及金鑰路徑的備份格式。
func (s *Service) ExportMobileSettings(ctx context.Context) (string, error) {
	s.mobileMu.Lock()
	defer s.mobileMu.Unlock()
	settings, err := s.repo.LoadSettings(ctx)
	if err != nil {
		return "", err
	}
	var source string
	if raw, ok := settings["mobileSyncSource"]; ok {
		if json.Unmarshal(raw, &source) != nil || source == "" {
			return "", errors.New("同步來源設定無效，原始資料已保留。")
		}
	} else {
		source = newID("desktop")
		raw, _ := json.Marshal(source)
		if err = s.repo.SaveSettings(ctx, dto.AppSettings{"mobileSyncSource": raw}); err != nil {
			return "", err
		}
	}
	hosts, err := s.repo.ListHosts(ctx)
	if err != nil {
		return "", err
	}
	groups, err := s.repo.ListGroups(ctx)
	if err != nil {
		return "", err
	}
	byID := make(map[string]dto.HostGroup, len(groups))
	for _, group := range groups {
		byID[group.ID] = group
	}
	projected := make([]mobilesettings.Host, 0, len(hosts))
	for _, h := range hosts {
		address := h.Config.Host
		if strings.HasPrefix(address, "[") && strings.HasSuffix(address, "]") {
			address = address[1 : len(address)-1]
		}
		path := []string{}
		seen := map[string]bool{}
		for id := h.GroupID; id != ""; {
			group, ok := byID[id]
			if !ok || seen[id] || len(path) >= 16 {
				return "", errors.New("主機資料夾結構無效，無法同步。")
			}
			seen[id] = true
			path = append([]string{group.Name}, path...)
			id = group.ParentID
		}
		projected = append(projected, mobilesettings.Host{FolderPath: path, ID: h.ID, Name: h.Label, Address: address, Port: h.Config.Port, Username: h.Config.Username})
	}
	return mobilesettings.Encode(source, projected)
}
