package hostvault

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"

	"gopkg.in/yaml.v3"
)

type importEnvelope struct {
	Hosts    []importHost    `json:"hosts" yaml:"hosts"`
	Groups   []dto.HostGroup `json:"groups" yaml:"groups"`
	Settings dto.AppSettings `json:"settings" yaml:"settings"`
	Version  string          `json:"version" yaml:"version"`
}

type importHost struct {
	ID        string           `json:"id" yaml:"id"`
	Label     string           `json:"label" yaml:"label"`
	Alias     string           `json:"alias" yaml:"alias"`
	GroupID   string           `json:"groupId" yaml:"groupId"`
	CreatedAt string           `json:"createdAt" yaml:"createdAt"`
	UpdatedAt string           `json:"updatedAt" yaml:"updatedAt"`
	Config    importHostConfig `json:"config" yaml:"config"`
}

type importHostConfig struct {
	Host                       string                    `json:"host" yaml:"host"`
	Port                       int                       `json:"port" yaml:"port"`
	Username                   string                    `json:"username" yaml:"username"`
	AuthMode                   string                    `json:"authMode" yaml:"authMode"`
	Password                   string                    `json:"password" yaml:"password"`
	PrivateKeyPath             string                    `json:"privateKeyPath" yaml:"privateKeyPath"`
	CertPath                   string                    `json:"certPath" yaml:"certPath"`
	SudoPassword               string                    `json:"sudoPassword" yaml:"sudoPassword"`
	SecretRefs                 dto.HostSecretRefs        `json:"secretRefs" yaml:"secretRefs"`
	Secret                     *importSecretBlock        `json:"secret" yaml:"secret"`
	ShowSnippetsInControlPanel bool                      `json:"showSnippetsInControlPanel" yaml:"showSnippetsInControlPanel"`
	StartupSnippetIDs          []string                  `json:"startupSnippetIds" yaml:"startupSnippetIds"`
	StartupCommandMode         string                    `json:"startupCommandMode" yaml:"startupCommandMode"`
	StartupCommandText         string                    `json:"startupCommandText" yaml:"startupCommandText"`
	CustomComponents           []dto.HostCustomComponent `json:"customComponents" yaml:"customComponents"`
	EnableCustomQuery          bool                      `json:"enableCustomQuery" yaml:"enableCustomQuery"`
	CustomQueryScript          string                    `json:"customQueryScript" yaml:"customQueryScript"`
}

type importSecretBlock struct {
	SSHPasswordRef   string                   `json:"sshPasswordRef" yaml:"sshPasswordRef"`
	KeyPassphraseRef string                   `json:"keyPassphraseRef" yaml:"keyPassphraseRef"`
	SudoPasswordRef  string                   `json:"sudoPasswordRef" yaml:"sudoPasswordRef"`
	SSHPassword      *dto.ExportedSecretValue `json:"sshPassword" yaml:"sshPassword"`
	KeyPassphrase    *dto.ExportedSecretValue `json:"keyPassphrase" yaml:"keyPassphrase"`
	SudoPassword     *dto.ExportedSecretValue `json:"sudoPassword" yaml:"sudoPassword"`
}

func (s *Service) Export(ctx context.Context, options dto.HostExportOptions) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(options.Mode))
	if mode == "" {
		mode = "reference"
	}

	snapshot, err := s.GetSnapshot(ctx)
	if err != nil {
		return "", err
	}

	exportedHosts := make([]dto.HostExportProfile, 0, len(snapshot.Hosts))
	for _, host := range snapshot.Hosts {
		exported := dto.HostExportProfile{
			ID:        host.ID,
			Label:     host.Label,
			Alias:     host.Alias,
			GroupID:   host.GroupID,
			CreatedAt: host.CreatedAt,
			UpdatedAt: host.UpdatedAt,
			Config: dto.HostExportConfig{
				Host:                       host.Config.Host,
				Port:                       host.Config.Port,
				Username:                   host.Config.Username,
				AuthMode:                   host.Config.AuthMode,
				PrivateKeyPath:             host.Config.PrivateKeyPath,
				CertPath:                   host.Config.CertPath,
				ShowSnippetsInControlPanel: host.Config.ShowSnippetsInControlPanel,
				StartupSnippetIDs:          host.Config.StartupSnippetIDs,
				StartupCommandMode:         host.Config.StartupCommandMode,
				StartupCommandText:         host.Config.StartupCommandText,
				CustomComponents:           host.Config.CustomComponents,
				EnableCustomQuery:          host.Config.EnableCustomQuery,
				CustomQueryScript:          host.Config.CustomQueryScript,
			},
		}

		if mode != "safe" {
			secretBlock := &dto.HostExportSecret{
				SSHPasswordRef:   host.Config.SecretRefs.SSHPasswordRef,
				KeyPassphraseRef: host.Config.SecretRefs.KeyPassphraseRef,
				SudoPasswordRef:  host.Config.SecretRefs.SudoPasswordRef,
			}
			if mode == "full" {
				if value, found, err := s.optionalSecret(ctx, host.Config.SecretRefs.SSHPasswordRef); err != nil {
					return "", err
				} else if found {
					secretBlock.SSHPassword = &dto.ExportedSecretValue{Ref: host.Config.SecretRefs.SSHPasswordRef, Value: value}
				}
				if value, found, err := s.optionalSecret(ctx, host.Config.SecretRefs.KeyPassphraseRef); err != nil {
					return "", err
				} else if found {
					secretBlock.KeyPassphrase = &dto.ExportedSecretValue{Ref: host.Config.SecretRefs.KeyPassphraseRef, Value: value}
				}
				if value, found, err := s.optionalSecret(ctx, host.Config.SecretRefs.SudoPasswordRef); err != nil {
					return "", err
				} else if found {
					secretBlock.SudoPassword = &dto.ExportedSecretValue{Ref: host.Config.SecretRefs.SudoPasswordRef, Value: value}
				}
			}
			exported.Config.Secret = secretBlock
		}

		exportedHosts = append(exportedHosts, exported)
	}

	envelope := dto.HostVaultExport{
		Version:    "hostvault.v1",
		ExportedAt: s.now().UTC().Format(time.RFC3339),
		Hosts:      exportedHosts,
		Groups:     snapshot.Groups,
		Settings:   cloneSettings(snapshot.Settings),
	}

	format := strings.ToLower(strings.TrimSpace(options.Format))
	if format == "yaml" || format == "yml" {
		bytes, err := yaml.Marshal(envelope)
		if err != nil {
			return "", fmt.Errorf("匯出 YAML 失敗：%w", err)
		}
		return string(bytes), nil
	}

	bytes, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return "", fmt.Errorf("匯出 JSON 失敗：%w", err)
	}
	return string(bytes), nil
}

func (s *Service) Import(ctx context.Context, payload string, options dto.HostImportOptions) (dto.HostImportResult, error) {
	var envelope importEnvelope
	if err := unmarshalPayload(payload, options.Format, &envelope); err != nil {
		return dto.HostImportResult{}, err
	}
	mode, err := normalizeImportMode(options.Mode)
	if err != nil {
		return dto.HostImportResult{}, err
	}

	result := dto.HostImportResult{
		Warnings: []string{},
	}

	validGroupIDs := make(map[string]struct{}, len(envelope.Groups))
	for _, group := range envelope.Groups {
		if _, err := s.SaveGroup(ctx, group); err != nil {
			return dto.HostImportResult{}, err
		}
		if strings.TrimSpace(group.ID) != "" {
			validGroupIDs[strings.TrimSpace(group.ID)] = struct{}{}
		}
		result.GroupsImported++
	}

	if len(envelope.Settings) > 0 {
		if _, err := s.SaveSettings(ctx, envelope.Settings); err != nil {
			return dto.HostImportResult{}, err
		}
		result.SettingsImported = len(envelope.Settings)
	}

	for _, imported := range envelope.Hosts {
		groupID := strings.TrimSpace(imported.GroupID)
		if groupID != "" {
			if _, ok := validGroupIDs[groupID]; !ok {
				if exists, err := s.repo.GroupExists(ctx, groupID); err != nil {
					return dto.HostImportResult{}, err
				} else if !exists {
					result.Warnings = append(result.Warnings, fmt.Sprintf("host %s 參照不存在的 group %s，已改為未分類", firstNonEmpty(imported.ID, imported.Label, imported.Config.Host), groupID))
					groupID = ""
				}
			}
		}

		secretRefs := mergeImportSecretRefs(imported.Config.SecretRefs, imported.Config.Secret)
		if mode == "config-only" {
			secretRefs = dto.HostSecretRefs{}
		}

		host := dto.HostProfile{
			ID:      imported.ID,
			Label:   imported.Label,
			Alias:   imported.Alias,
			GroupID: groupID,
			Config: dto.PersistedHostConfig{
				Host:                       imported.Config.Host,
				Port:                       imported.Config.Port,
				Username:                   imported.Config.Username,
				AuthMode:                   imported.Config.AuthMode,
				PrivateKeyPath:             imported.Config.PrivateKeyPath,
				CertPath:                   imported.Config.CertPath,
				SecretRefs:                 secretRefs,
				ShowSnippetsInControlPanel: imported.Config.ShowSnippetsInControlPanel,
				StartupSnippetIDs:          imported.Config.StartupSnippetIDs,
				StartupCommandMode:         imported.Config.StartupCommandMode,
				StartupCommandText:         imported.Config.StartupCommandText,
				CustomComponents:           imported.Config.CustomComponents,
				EnableCustomQuery:          imported.Config.EnableCustomQuery,
				CustomQueryScript:          imported.Config.CustomQueryScript,
			},
			CreatedAt: imported.CreatedAt,
			UpdatedAt: imported.UpdatedAt,
		}

		secretsInput := dto.HostSecretsInput{}
		shouldWriteSecrets := mode == "reference+secret"
		if shouldWriteSecrets && imported.Config.Secret != nil {
			if imported.Config.Secret.SSHPassword != nil {
				secretsInput.SSHPassword = dto.SecretValueInput{
					Ref:      imported.Config.Secret.SSHPassword.Ref,
					Value:    imported.Config.Secret.SSHPassword.Value,
					HasValue: true,
				}
			}
			if imported.Config.Secret.KeyPassphrase != nil {
				secretsInput.KeyPassphrase = dto.SecretValueInput{
					Ref:      imported.Config.Secret.KeyPassphrase.Ref,
					Value:    imported.Config.Secret.KeyPassphrase.Value,
					HasValue: true,
				}
			}
			if imported.Config.Secret.SudoPassword != nil {
				secretsInput.SudoPassword = dto.SecretValueInput{
					Ref:      imported.Config.Secret.SudoPassword.Ref,
					Value:    imported.Config.Secret.SudoPassword.Value,
					HasValue: true,
				}
			}
		}

		if shouldWriteSecrets && strings.TrimSpace(imported.Config.Password) != "" {
			if imported.Config.AuthMode == constants.AuthModePassword {
				secretsInput.SSHPassword = dto.SecretValueInput{
					Value:    imported.Config.Password,
					HasValue: true,
				}
			} else {
				secretsInput.KeyPassphrase = dto.SecretValueInput{
					Value:    imported.Config.Password,
					HasValue: true,
				}
			}
			result.Warnings = append(result.Warnings, fmt.Sprintf("host %s 使用 legacy password 欄位匯入，已轉存至 secret store", firstNonEmpty(imported.ID, imported.Label, imported.Config.Host)))
		} else if strings.TrimSpace(imported.Config.Password) != "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("host %s 使用 legacy password 欄位匯入，但目前模式未寫入 secret value", firstNonEmpty(imported.ID, imported.Label, imported.Config.Host)))
		}
		if shouldWriteSecrets && strings.TrimSpace(imported.Config.SudoPassword) != "" {
			secretsInput.SudoPassword = dto.SecretValueInput{
				Value:    imported.Config.SudoPassword,
				HasValue: true,
			}
			result.Warnings = append(result.Warnings, fmt.Sprintf("host %s 使用 legacy sudoPassword 欄位匯入，已轉存至 secret store", firstNonEmpty(imported.ID, imported.Label, imported.Config.Host)))
		} else if strings.TrimSpace(imported.Config.SudoPassword) != "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("host %s 使用 legacy sudoPassword 欄位匯入，但目前模式未寫入 secret value", firstNonEmpty(imported.ID, imported.Label, imported.Config.Host)))
		}

		_, secretWrites, err := s.SaveHost(ctx, dto.SaveHostRequest{
			Host:    host,
			Secrets: secretsInput,
		})
		if err != nil {
			return dto.HostImportResult{}, err
		}
		result.HostsImported++
		result.SecretsWritten += secretWrites
	}

	return result, nil
}

func normalizeImportMode(mode string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(mode))
	if normalized == "" {
		return "reference-only", nil
	}
	switch normalized {
	case "config-only", "reference-only", "reference+secret":
		return normalized, nil
	default:
		return "", fmt.Errorf("不支援的匯入模式：%s", mode)
	}
}

func unmarshalPayload(payload string, format string, target any) error {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return fmt.Errorf("匯入內容不可空白")
	}

	lowerFormat := strings.ToLower(strings.TrimSpace(format))
	switch lowerFormat {
	case "yaml", "yml":
		if err := yaml.Unmarshal([]byte(payload), target); err != nil {
			return fmt.Errorf("解析 YAML 匯入內容失敗：%w", err)
		}
		return nil
	case "json":
		if err := json.Unmarshal([]byte(payload), target); err != nil {
			return fmt.Errorf("解析 JSON 匯入內容失敗：%w", err)
		}
		return nil
	default:
		if strings.HasPrefix(payload, "{") || strings.HasPrefix(payload, "[") {
			if err := json.Unmarshal([]byte(payload), target); err != nil {
				return fmt.Errorf("解析 JSON 匯入內容失敗：%w", err)
			}
			return nil
		}
		if err := yaml.Unmarshal([]byte(payload), target); err != nil {
			return fmt.Errorf("解析 YAML 匯入內容失敗：%w", err)
		}
		return nil
	}
}

func mergeImportSecretRefs(current dto.HostSecretRefs, secret *importSecretBlock) dto.HostSecretRefs {
	if secret == nil {
		return current
	}
	current.SSHPasswordRef = firstNonEmpty(secret.SSHPasswordRef, secretValueRef(secret.SSHPassword), current.SSHPasswordRef)
	current.KeyPassphraseRef = firstNonEmpty(secret.KeyPassphraseRef, secretValueRef(secret.KeyPassphrase), current.KeyPassphraseRef)
	current.SudoPasswordRef = firstNonEmpty(secret.SudoPasswordRef, secretValueRef(secret.SudoPassword), current.SudoPasswordRef)
	return current
}

func secretValueRef(secret *dto.ExportedSecretValue) string {
	if secret == nil {
		return ""
	}
	return secret.Ref
}
