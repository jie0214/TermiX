package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jie0214/TermiX/shared/dto"
)

var ErrGCPIntegrationNotFound = errors.New("GCP 整合設定不存在")

func (r *Repository) ListGCPIntegrations(ctx context.Context) ([]dto.GCPIntegration, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT
		group_id,
		name,
		project_id,
		service_account_json_ref,
		default_password_ref,
		ip_address_type,
		default_port,
		default_username,
		auth_mode,
		private_key_path,
		cert_path,
		last_sync_at,
		created_at,
		updated_at
	FROM gcp_integrations
	ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("查詢 gcp_integrations 失敗：%w", err)
	}
	defer rows.Close()

	integrations := make([]dto.GCPIntegration, 0)
	for rows.Next() {
		var item dto.GCPIntegration
		err := rows.Scan(
			&item.GroupID,
			&item.Name,
			&item.ProjectID,
			&item.ServiceAccountJSONRef,
			&item.DefaultPasswordRef,
			&item.IPAddressType,
			&item.DefaultPort,
			&item.DefaultUsername,
			&item.AuthMode,
			&item.PrivateKeyPath,
			&item.CertPath,
			&item.LastSyncAt,
			&item.CreatedAt,
			&item.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("掃描 gcp_integrations 失敗：%w", err)
		}
		integrations = append(integrations, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 gcp_integrations 失敗：%w", err)
	}
	return integrations, nil
}

func (r *Repository) GetGCPIntegration(ctx context.Context, groupID string) (dto.GCPIntegration, error) {
	row := r.db.QueryRowContext(ctx, `SELECT
		group_id,
		name,
		project_id,
		service_account_json_ref,
		default_password_ref,
		ip_address_type,
		default_port,
		default_username,
		auth_mode,
		private_key_path,
		cert_path,
		last_sync_at,
		created_at,
		updated_at
	FROM gcp_integrations
	WHERE group_id = ?`, strings.TrimSpace(groupID))

	var item dto.GCPIntegration
	err := row.Scan(
		&item.GroupID,
		&item.Name,
		&item.ProjectID,
		&item.ServiceAccountJSONRef,
		&item.DefaultPasswordRef,
		&item.IPAddressType,
		&item.DefaultPort,
		&item.DefaultUsername,
		&item.AuthMode,
		&item.PrivateKeyPath,
		&item.CertPath,
		&item.LastSyncAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dto.GCPIntegration{}, ErrGCPIntegrationNotFound
		}
		return dto.GCPIntegration{}, fmt.Errorf("查詢 gcp_integration 失敗：%w", err)
	}
	return item, nil
}

func (r *Repository) SaveGCPIntegration(ctx context.Context, item dto.GCPIntegration) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO gcp_integrations (
		group_id,
		name,
		project_id,
		service_account_json_ref,
		default_password_ref,
		ip_address_type,
		default_port,
		default_username,
		auth_mode,
		private_key_path,
		cert_path,
		last_sync_at,
		created_at,
		updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(group_id) DO UPDATE SET
		name = excluded.name,
		project_id = excluded.project_id,
		service_account_json_ref = excluded.service_account_json_ref,
		default_password_ref = excluded.default_password_ref,
		ip_address_type = excluded.ip_address_type,
		default_port = excluded.default_port,
		default_username = excluded.default_username,
		auth_mode = excluded.auth_mode,
		private_key_path = excluded.private_key_path,
		cert_path = excluded.cert_path,
		last_sync_at = excluded.last_sync_at,
		updated_at = excluded.updated_at`,
		strings.TrimSpace(item.GroupID),
		strings.TrimSpace(item.Name),
		strings.TrimSpace(item.ProjectID),
		strings.TrimSpace(item.ServiceAccountJSONRef),
		strings.TrimSpace(item.DefaultPasswordRef),
		strings.TrimSpace(item.IPAddressType),
		item.DefaultPort,
		strings.TrimSpace(item.DefaultUsername),
		strings.TrimSpace(item.AuthMode),
		strings.TrimSpace(item.PrivateKeyPath),
		strings.TrimSpace(item.CertPath),
		strings.TrimSpace(item.LastSyncAt),
		item.CreatedAt,
		item.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("儲存 gcp_integration 失敗：%w", err)
	}
	return nil
}

func (r *Repository) DeleteGCPIntegration(ctx context.Context, groupID string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM gcp_integrations WHERE group_id = ?`, strings.TrimSpace(groupID))
	if err != nil {
		return fmt.Errorf("刪除 gcp_integration 失敗：%w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("取得 gcp_integration 刪除結果失敗：%w", err)
	}
	if affected == 0 {
		return ErrGCPIntegrationNotFound
	}
	return nil
}

func (r *Repository) AddDeletedGCPInstance(ctx context.Context, gcpInstanceID string, groupID string) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO deleted_gcp_instances (gcp_instance_id, group_id, deleted_at)
	VALUES (?, ?, ?)
	ON CONFLICT(gcp_instance_id) DO UPDATE SET
		group_id = excluded.group_id,
		deleted_at = excluded.deleted_at`,
		strings.TrimSpace(gcpInstanceID),
		strings.TrimSpace(groupID),
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("儲存已刪除 GCP 實例記錄失敗：%w", err)
	}
	return nil
}

func (r *Repository) ListDeletedGCPInstances(ctx context.Context, groupID string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT gcp_instance_id FROM deleted_gcp_instances WHERE group_id = ?`, strings.TrimSpace(groupID))
	if err != nil {
		return nil, fmt.Errorf("查詢已刪除 GCP 實例失敗：%w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("掃描已刪除 GCP 實例失敗：%w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取已刪除 GCP 實例失敗：%w", err)
	}
	return ids, nil
}

func (r *Repository) DeleteDeletedGCPInstance(ctx context.Context, gcpInstanceID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM deleted_gcp_instances WHERE gcp_instance_id = ?`, strings.TrimSpace(gcpInstanceID))
	if err != nil {
		return fmt.Errorf("刪除已排除 GCP 實例記錄失敗：%w", err)
	}
	return nil
}

func (r *Repository) CleanDeletedGCPInstancesByGroup(ctx context.Context, groupID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM deleted_gcp_instances WHERE group_id = ?`, strings.TrimSpace(groupID))
	if err != nil {
		return fmt.Errorf("清除群組已刪除 GCP 實例失敗：%w", err)
	}
	return nil
}
