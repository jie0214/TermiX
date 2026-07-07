package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jie0214/TermiX/shared/dto"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(database *Database) *Repository {
	return &Repository{db: database.DB}
}

func (r *Repository) ListKubernetesClusters(ctx context.Context) ([]dto.KubernetesClusterProfile, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, display_name, kubeconfig_path, context_name,
		cluster_name, server, user_name, namespace, certificate_authority,
		insecure_skip_tls_verify, created_at, updated_at FROM kubernetes_clusters`)
	if err != nil {
		return nil, fmt.Errorf("查詢 Kubernetes 叢集中繼資料失敗：%w", err)
	}
	defer rows.Close()
	items := make([]dto.KubernetesClusterProfile, 0)
	for rows.Next() {
		var item dto.KubernetesClusterProfile
		if err := rows.Scan(&item.ID, &item.DisplayName, &item.KubeconfigPath, &item.ContextName,
			&item.ClusterName, &item.Server, &item.UserName, &item.Namespace,
			&item.CertificateAuthority, &item.InsecureSkipTLSVerify, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("讀取 Kubernetes 叢集中繼資料失敗：%w", err)
		}
		item.Source = "managed"
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 Kubernetes 叢集中繼資料失敗：%w", err)
	}
	return items, nil
}

func (r *Repository) SaveKubernetesCluster(ctx context.Context, item dto.KubernetesClusterProfile) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO kubernetes_clusters (
		id, display_name, kubeconfig_path, context_name, cluster_name, server, user_name,
		namespace, certificate_authority, insecure_skip_tls_verify, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
		kubeconfig_path=excluded.kubeconfig_path, context_name=excluded.context_name,
		cluster_name=excluded.cluster_name, server=excluded.server, user_name=excluded.user_name,
		namespace=excluded.namespace, certificate_authority=excluded.certificate_authority,
		insecure_skip_tls_verify=excluded.insecure_skip_tls_verify, updated_at=excluded.updated_at`,
		item.ID, item.DisplayName, item.KubeconfigPath, item.ContextName, item.ClusterName,
		item.Server, item.UserName, item.Namespace, item.CertificateAuthority,
		item.InsecureSkipTLSVerify, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return fmt.Errorf("儲存 Kubernetes 叢集中繼資料失敗：%w", err)
	}
	return nil
}

func (r *Repository) DeleteKubernetesCluster(ctx context.Context, id string) error {
	if _, err := r.db.ExecContext(ctx, "DELETE FROM kubernetes_clusters WHERE id = ?", strings.TrimSpace(id)); err != nil {
		return fmt.Errorf("刪除 Kubernetes 叢集中繼資料失敗：%w", err)
	}
	return nil
}

func (r *Repository) ListHosts(ctx context.Context) ([]dto.HostProfile, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT
		id,
		label,
		alias,
		COALESCE(group_id, ''),
		COALESCE(aws_instance_id, ''),
		COALESCE(gcp_instance_id, ''),
		host,
		port,
		username,
		auth_mode,
		private_key_path,
		keychain_key_id,
		cert_path,
		ssh_password_ref,
		key_passphrase_ref,
		sudo_password_ref,
		show_snippets_in_control_panel,
		startup_snippet_ids_json,
		startup_command_mode,
		startup_command_text,
		custom_components_json,
		enable_custom_query,
		custom_query_script,
		created_at,
		updated_at
	FROM hosts
	ORDER BY updated_at DESC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查詢 hosts 失敗：%w", err)
	}
	defer rows.Close()

	hosts := make([]dto.HostProfile, 0)
	for rows.Next() {
		host, err := scanHost(rows)
		if err != nil {
			return nil, err
		}
		hosts = append(hosts, host)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 hosts 失敗：%w", err)
	}
	return hosts, nil
}

func (r *Repository) GetHost(ctx context.Context, id string) (dto.HostProfile, error) {
	row := r.db.QueryRowContext(ctx, `SELECT
		id,
		label,
		alias,
		COALESCE(group_id, ''),
		COALESCE(aws_instance_id, ''),
		COALESCE(gcp_instance_id, ''),
		host,
		port,
		username,
		auth_mode,
		private_key_path,
		keychain_key_id,
		cert_path,
		ssh_password_ref,
		key_passphrase_ref,
		sudo_password_ref,
		show_snippets_in_control_panel,
		startup_snippet_ids_json,
		startup_command_mode,
		startup_command_text,
		custom_components_json,
		enable_custom_query,
		custom_query_script,
		created_at,
		updated_at
	FROM hosts
	WHERE id = ?`, strings.TrimSpace(id))

	host, err := scanHost(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dto.HostProfile{}, ErrHostNotFound
		}
		return dto.HostProfile{}, err
	}
	return host, nil
}

func (r *Repository) SaveHost(ctx context.Context, host dto.HostProfile) error {
	startupSnippetIDsJSON, err := marshalJSON(host.Config.StartupSnippetIDs)
	if err != nil {
		return fmt.Errorf("序列化 startupSnippetIds 失敗：%w", err)
	}
	customComponentsJSON, err := marshalJSON(host.Config.CustomComponents)
	if err != nil {
		return fmt.Errorf("序列化 customComponents 失敗：%w", err)
	}

	_, err = r.db.ExecContext(ctx, `INSERT INTO hosts (
		id,
		label,
		alias,
		group_id,
		aws_instance_id,
		gcp_instance_id,
		host,
		port,
		username,
		auth_mode,
		private_key_path,
		keychain_key_id,
		cert_path,
		ssh_password_ref,
		key_passphrase_ref,
		sudo_password_ref,
		show_snippets_in_control_panel,
		startup_snippet_ids_json,
		startup_command_mode,
		startup_command_text,
		custom_components_json,
		enable_custom_query,
		custom_query_script,
		created_at,
		updated_at
	) VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		label = excluded.label,
		alias = excluded.alias,
		group_id = excluded.group_id,
		aws_instance_id = excluded.aws_instance_id,
		gcp_instance_id = excluded.gcp_instance_id,
		host = excluded.host,
		port = excluded.port,
		username = excluded.username,
		auth_mode = excluded.auth_mode,
		private_key_path = excluded.private_key_path,
		keychain_key_id = excluded.keychain_key_id,
		cert_path = excluded.cert_path,
		ssh_password_ref = excluded.ssh_password_ref,
		key_passphrase_ref = excluded.key_passphrase_ref,
		sudo_password_ref = excluded.sudo_password_ref,
		show_snippets_in_control_panel = excluded.show_snippets_in_control_panel,
		startup_snippet_ids_json = excluded.startup_snippet_ids_json,
		startup_command_mode = excluded.startup_command_mode,
		startup_command_text = excluded.startup_command_text,
		custom_components_json = excluded.custom_components_json,
		enable_custom_query = excluded.enable_custom_query,
		custom_query_script = excluded.custom_query_script,
		updated_at = excluded.updated_at`,
		host.ID,
		host.Label,
		host.Alias,
		host.GroupID,
		host.AWSInstanceID,
		host.GCPInstanceID,
		host.Config.Host,
		host.Config.Port,
		host.Config.Username,
		host.Config.AuthMode,
		host.Config.PrivateKeyPath,
		host.Config.KeychainKeyID,
		host.Config.CertPath,
		host.Config.SecretRefs.SSHPasswordRef,
		host.Config.SecretRefs.KeyPassphraseRef,
		host.Config.SecretRefs.SudoPasswordRef,
		boolToInt(host.Config.ShowSnippetsInControlPanel),
		startupSnippetIDsJSON,
		host.Config.StartupCommandMode,
		host.Config.StartupCommandText,
		customComponentsJSON,
		boolToInt(host.Config.EnableCustomQuery),
		host.Config.CustomQueryScript,
		host.CreatedAt,
		host.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("儲存 host 失敗：%w", err)
	}
	return nil
}

func (r *Repository) DeleteHost(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM hosts WHERE id = ?`, strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("刪除 host 失敗：%w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("取得 host 刪除結果失敗：%w", err)
	}
	if affected == 0 {
		return ErrHostNotFound
	}
	return nil
}

func (r *Repository) ListGroups(ctx context.Context) ([]dto.HostGroup, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name, COALESCE(parent_id, ''), order_index, created_at, updated_at FROM host_groups ORDER BY order_index ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查詢 host_groups 失敗：%w", err)
	}
	defer rows.Close()

	groups := make([]dto.HostGroup, 0)
	for rows.Next() {
		var group dto.HostGroup
		if err := rows.Scan(&group.ID, &group.Name, &group.ParentID, &group.Order, &group.CreatedAt, &group.UpdatedAt); err != nil {
			return nil, fmt.Errorf("讀取 host_groups 失敗：%w", err)
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 host_groups 失敗：%w", err)
	}
	return groups, nil
}

func (r *Repository) SaveGroup(ctx context.Context, group dto.HostGroup) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO host_groups (id, name, parent_id, order_index, created_at, updated_at)
	VALUES (?, ?, NULLIF(?, ''), ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name,
		parent_id = excluded.parent_id,
		order_index = excluded.order_index,
		updated_at = excluded.updated_at`,
		group.ID,
		group.Name,
		group.ParentID,
		group.Order,
		group.CreatedAt,
		group.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("儲存 host group 失敗：%w", err)
	}
	return nil
}

func (r *Repository) DeleteGroup(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM host_groups WHERE id = ?`, strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("刪除 host group 失敗：%w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("取得 host group 刪除結果失敗：%w", err)
	}
	if affected == 0 {
		return ErrGroupNotFound
	}
	return nil
}

func (r *Repository) GetGroup(ctx context.Context, id string) (dto.HostGroup, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, name, COALESCE(parent_id, ''), order_index, created_at, updated_at FROM host_groups WHERE id = ?`, strings.TrimSpace(id))
	var group dto.HostGroup
	if err := row.Scan(&group.ID, &group.Name, &group.ParentID, &group.Order, &group.CreatedAt, &group.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dto.HostGroup{}, ErrGroupNotFound
		}
		return dto.HostGroup{}, fmt.Errorf("查詢 host group 失敗：%w", err)
	}
	return group, nil
}

func (r *Repository) LoadSettings(ctx context.Context) (dto.AppSettings, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT key, value_json FROM app_settings ORDER BY key ASC`)
	if err != nil {
		return nil, fmt.Errorf("查詢 app_settings 失敗：%w", err)
	}
	defer rows.Close()

	settings := dto.AppSettings{}
	for rows.Next() {
		var key string
		var value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("讀取 app_settings 失敗：%w", err)
		}
		settings[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 app_settings 失敗：%w", err)
	}
	return settings, nil
}

func (r *Repository) SaveSettings(ctx context.Context, settings dto.AppSettings) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("建立 app_settings 交易失敗：%w", err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	now := time.Now().UTC().Format(time.RFC3339)
	keys := make([]string, 0, len(settings))
	for key := range settings {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			return errors.New("app setting key 不可空白")
		}
		value := strings.TrimSpace(string(settings[key]))
		if value == "" {
			value = "null"
		}
		if !json.Valid([]byte(value)) {
			return fmt.Errorf("app setting %s 不是有效 JSON", trimmedKey)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value_json = excluded.value_json,
			updated_at = excluded.updated_at`, trimmedKey, value, now); err != nil {
			return fmt.Errorf("儲存 app setting %s 失敗：%w", trimmedKey, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交 app_settings 交易失敗：%w", err)
	}
	tx = nil
	return nil
}

func scanHost(scanner interface {
	Scan(dest ...any) error
}) (dto.HostProfile, error) {
	var (
		host                  dto.HostProfile
		showSnippets          int
		startupSnippetIDsJSON string
		customComponentsJSON  string
		enableCustomQuery     int
		startupSnippetIDs     []string
		customComponents      []dto.HostCustomComponent
	)

	err := scanner.Scan(
		&host.ID,
		&host.Label,
		&host.Alias,
		&host.GroupID,
		&host.AWSInstanceID,
		&host.GCPInstanceID,
		&host.Config.Host,
		&host.Config.Port,
		&host.Config.Username,
		&host.Config.AuthMode,
		&host.Config.PrivateKeyPath,
		&host.Config.KeychainKeyID,
		&host.Config.CertPath,
		&host.Config.SecretRefs.SSHPasswordRef,
		&host.Config.SecretRefs.KeyPassphraseRef,
		&host.Config.SecretRefs.SudoPasswordRef,
		&showSnippets,
		&startupSnippetIDsJSON,
		&host.Config.StartupCommandMode,
		&host.Config.StartupCommandText,
		&customComponentsJSON,
		&enableCustomQuery,
		&host.Config.CustomQueryScript,
		&host.CreatedAt,
		&host.UpdatedAt,
	)
	if err != nil {
		return dto.HostProfile{}, err
	}
	if err := unmarshalJSON(startupSnippetIDsJSON, &startupSnippetIDs); err != nil {
		return dto.HostProfile{}, fmt.Errorf("解析 startupSnippetIds 失敗：%w", err)
	}
	if err := unmarshalJSON(customComponentsJSON, &customComponents); err != nil {
		return dto.HostProfile{}, fmt.Errorf("解析 customComponents 失敗：%w", err)
	}

	host.Config.ShowSnippetsInControlPanel = showSnippets == 1
	host.Config.StartupSnippetIDs = startupSnippetIDs
	host.Config.CustomComponents = customComponents
	host.Config.EnableCustomQuery = enableCustomQuery == 1
	return host, nil
}

func marshalJSON(value any) (string, error) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func unmarshalJSON(raw string, target any) error {
	if strings.TrimSpace(raw) == "" {
		raw = "[]"
	}
	return json.Unmarshal([]byte(raw), target)
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

var (
	ErrHostNotFound        = errors.New("host 不存在")
	ErrGroupNotFound       = errors.New("host group 不存在")
	ErrKeychainKeyNotFound = errors.New("keychain 金鑰不存在")
)

func (r *Repository) ListKeychainKeys(ctx context.Context) ([]dto.KeychainKey, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, label, type, bits, public_key, fingerprint,
		comment, has_passphrase, private_key_ref, created_at, updated_at
		FROM keychain_keys ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("查詢 keychain_keys 失敗：%w", err)
	}
	defer rows.Close()

	keys := make([]dto.KeychainKey, 0)
	for rows.Next() {
		key, scanErr := scanKeychainKey(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 keychain_keys 失敗：%w", err)
	}
	return keys, nil
}

func (r *Repository) GetKeychainKey(ctx context.Context, id string) (dto.KeychainKey, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, label, type, bits, public_key, fingerprint,
		comment, has_passphrase, private_key_ref, created_at, updated_at
		FROM keychain_keys WHERE id = ?`, strings.TrimSpace(id))
	key, err := scanKeychainKey(row)
	if errors.Is(err, sql.ErrNoRows) {
		return dto.KeychainKey{}, ErrKeychainKeyNotFound
	}
	if err != nil {
		return dto.KeychainKey{}, err
	}
	return key, nil
}

func (r *Repository) SaveKeychainKey(ctx context.Context, key dto.KeychainKey) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO keychain_keys (
		id, label, type, bits, public_key, fingerprint, comment,
		has_passphrase, private_key_ref, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET label=excluded.label, type=excluded.type, bits=excluded.bits,
		public_key=excluded.public_key, fingerprint=excluded.fingerprint, comment=excluded.comment,
		has_passphrase=excluded.has_passphrase, private_key_ref=excluded.private_key_ref,
		updated_at=excluded.updated_at`,
		key.ID, key.Label, key.Type, key.Bits, key.PublicKey, key.Fingerprint, key.Comment,
		boolToInt(key.HasPassphrase), key.PrivateKeyRef, key.CreatedAt, key.UpdatedAt)
	if err != nil {
		return fmt.Errorf("儲存 keychain 金鑰中繼資料失敗：%w", err)
	}
	return nil
}

func (r *Repository) DeleteKeychainKey(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM keychain_keys WHERE id = ?`, strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("刪除 keychain 金鑰失敗：%w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("取得 keychain 金鑰刪除結果失敗：%w", err)
	}
	if affected == 0 {
		return ErrKeychainKeyNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanKeychainKey(scanner rowScanner) (dto.KeychainKey, error) {
	var key dto.KeychainKey
	var hasPassphrase int
	if err := scanner.Scan(&key.ID, &key.Label, &key.Type, &key.Bits, &key.PublicKey,
		&key.Fingerprint, &key.Comment, &hasPassphrase, &key.PrivateKeyRef,
		&key.CreatedAt, &key.UpdatedAt); err != nil {
		return dto.KeychainKey{}, err
	}
	key.HasPassphrase = hasPassphrase != 0
	return key, nil
}

func (r *Repository) GroupExists(ctx context.Context, id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}
	row := r.db.QueryRowContext(ctx, `SELECT 1 FROM host_groups WHERE id = ?`, id)
	var marker int
	if err := row.Scan(&marker); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("查詢 host group 失敗：%w", err)
	}
	return true, nil
}

var ErrAWSIntegrationNotFound = errors.New("AWS 整合設定不存在")

func (r *Repository) ListAWSIntegrations(ctx context.Context) ([]dto.AWSIntegration, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT
		group_id,
		name,
		region,
		access_key_id,
		secret_access_key_ref,
		default_password_ref,
		import_source,
		ip_address_type,
		default_port,
		default_username,
		auth_mode,
		private_key_path,
		cert_path,
		last_sync_at,
		created_at,
		updated_at
	FROM aws_integrations
	ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("查詢 aws_integrations 失敗：%w", err)
	}
	defer rows.Close()

	integrations := make([]dto.AWSIntegration, 0)
	for rows.Next() {
		var item dto.AWSIntegration
		err := rows.Scan(
			&item.GroupID,
			&item.Name,
			&item.Region,
			&item.AccessKeyID,
			&item.SecretAccessKeyRef,
			&item.DefaultPasswordRef,
			&item.ImportSource,
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
			return nil, fmt.Errorf("掃描 aws_integrations 失敗：%w", err)
		}
		integrations = append(integrations, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取 aws_integrations 失敗：%w", err)
	}
	return integrations, nil
}

func (r *Repository) GetAWSIntegration(ctx context.Context, groupID string) (dto.AWSIntegration, error) {
	row := r.db.QueryRowContext(ctx, `SELECT
		group_id,
		name,
		region,
		access_key_id,
		secret_access_key_ref,
		default_password_ref,
		import_source,
		ip_address_type,
		default_port,
		default_username,
		auth_mode,
		private_key_path,
		cert_path,
		last_sync_at,
		created_at,
		updated_at
	FROM aws_integrations
	WHERE group_id = ?`, strings.TrimSpace(groupID))

	var item dto.AWSIntegration
	err := row.Scan(
		&item.GroupID,
		&item.Name,
		&item.Region,
		&item.AccessKeyID,
		&item.SecretAccessKeyRef,
		&item.DefaultPasswordRef,
		&item.ImportSource,
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
			return dto.AWSIntegration{}, ErrAWSIntegrationNotFound
		}
		return dto.AWSIntegration{}, fmt.Errorf("查詢 aws_integration 失敗：%w", err)
	}
	return item, nil
}

func (r *Repository) SaveAWSIntegration(ctx context.Context, item dto.AWSIntegration) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO aws_integrations (
		group_id,
		name,
		region,
		access_key_id,
		secret_access_key_ref,
		default_password_ref,
		import_source,
		ip_address_type,
		default_port,
		default_username,
		auth_mode,
		private_key_path,
		cert_path,
		last_sync_at,
		created_at,
		updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(group_id) DO UPDATE SET
		name = excluded.name,
		region = excluded.region,
		access_key_id = excluded.access_key_id,
		secret_access_key_ref = excluded.secret_access_key_ref,
		default_password_ref = excluded.default_password_ref,
		import_source = excluded.import_source,
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
		strings.TrimSpace(item.Region),
		strings.TrimSpace(item.AccessKeyID),
		strings.TrimSpace(item.SecretAccessKeyRef),
		strings.TrimSpace(item.DefaultPasswordRef),
		strings.TrimSpace(item.ImportSource),
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
		return fmt.Errorf("儲存 aws_integration 失敗：%w", err)
	}
	return nil
}

func (r *Repository) DeleteAWSIntegration(ctx context.Context, groupID string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM aws_integrations WHERE group_id = ?`, strings.TrimSpace(groupID))
	if err != nil {
		return fmt.Errorf("刪除 aws_integration 失敗：%w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("取得 aws_integration 刪除結果失敗：%w", err)
	}
	if affected == 0 {
		return ErrAWSIntegrationNotFound
	}
	return nil
}

func (r *Repository) AddDeletedAWSInstance(ctx context.Context, awsInstanceID string, groupID string) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO deleted_aws_instances (aws_instance_id, group_id, deleted_at)
	VALUES (?, ?, ?)
	ON CONFLICT(aws_instance_id) DO UPDATE SET
		group_id = excluded.group_id,
		deleted_at = excluded.deleted_at`,
		strings.TrimSpace(awsInstanceID),
		strings.TrimSpace(groupID),
		time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("儲存已刪除 AWS 實例記錄失敗：%w", err)
	}
	return nil
}

func (r *Repository) ListDeletedAWSInstances(ctx context.Context, groupID string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT aws_instance_id FROM deleted_aws_instances WHERE group_id = ?`, strings.TrimSpace(groupID))
	if err != nil {
		return nil, fmt.Errorf("查詢已刪除 AWS 實例失敗：%w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("掃描已刪除 AWS 實例失敗：%w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("讀取已刪除 AWS 實例失敗：%w", err)
	}
	return ids, nil
}

func (r *Repository) DeleteDeletedAWSInstance(ctx context.Context, awsInstanceID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM deleted_aws_instances WHERE aws_instance_id = ?`, strings.TrimSpace(awsInstanceID))
	if err != nil {
		return fmt.Errorf("刪除已排除 AWS 實例記錄失敗：%w", err)
	}
	return nil
}

func (r *Repository) CleanDeletedAWSInstancesByGroup(ctx context.Context, groupID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM deleted_aws_instances WHERE group_id = ?`, strings.TrimSpace(groupID))
	if err != nil {
		return fmt.Errorf("清除群組已刪除 AWS 實例失敗：%w", err)
	}
	return nil
}
