import type { CredentialStore } from '../hosts/credentials.ts';
export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string };
export type AwsProfile = { key: string; name: string; region: string; enabled: boolean; account: string; arn: string };
export type EksConfig = { clusterName: string; region: string; profile: string; roleArn?: string; credentialKey: string };
export interface AwsNative {
  awsProfileKey(region: string, profile: string): Promise<string>;
  loginAWS(region: string, credentials: string): Promise<string>;
  authorizeEKS(raw: string, credentials: string): Promise<string>;
}
const indexKey = 'termix.aws.profiles.v1';
export const awsMessage = (error: unknown) => {
  const value = error instanceof Error ? error.message : '';
  for (const [code, message] of Object.entries({
    aws_profile_invalid: '請填寫有效的 profile 名稱與 AWS Region。',
    aws_credentials_invalid: 'AWS 憑證無效，請確認 Access Key 與 Secret Key。',
    aws_session_token_required: '暫時憑證需要 Session Token。',
    aws_credentials_expired: 'AWS 暫時憑證已過期，請更新此 profile。',
    aws_access_denied: 'AWS 拒絕此操作，請確認 IAM 權限或 Role 設定。',
    aws_connection_failed: '無法完成 AWS 驗證，請確認網路後重試。',
    aws_profile_disabled: '此 AWS profile 已停用。',
    aws_login_required: '請先在設定新增並啟用同名 AWS profile。',
  })) if (new RegExp(`(?:^|[^a-z_])${code}(?:$|[^a-z_])`).test(value)) return message;
  return 'AWS 設定操作失敗，請重試。';
};

export class AwsRepository {
  private pending: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private vault: CredentialStore; private native: AwsNative;
  constructor(vault: CredentialStore, native: AwsNative) { this.vault = vault; this.native = native; }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(operation); this.pending = task.catch(() => undefined); return task;
  }
  async list(): Promise<AwsProfile[]> {
    const raw = await this.vault.get(indexKey);
    if (raw === null) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > 32) throw new Error('aws_storage_invalid');
    const seen = new Set<string>();
    for (const p of data) {
      if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !/^termix\.aws\.[a-f0-9]{64}$/.test(p.key) ||
        seen.has(p.key) || typeof p.name !== 'string' || typeof p.region !== 'string' || typeof p.enabled !== 'boolean' ||
        typeof p.account !== 'string' || typeof p.arn !== 'string') throw new Error('aws_storage_invalid');
      seen.add(p.key);
    }
    return data;
  }
  save(name: string, region: string, credentials: AwsCredentials): Promise<void> {
    return this.serial(async () => {
      name = name.trim(); region = region.trim();
      const key = await this.native.awsProfileKey(region, name);
      const profiles = await this.list();
      if (profiles.length >= 32 && !profiles.some(p => p.key === key)) throw new Error('aws_storage_full');
      const value = JSON.stringify({ accessKeyId: credentials.accessKeyId.trim(), secretAccessKey: credentials.secretAccessKey.trim(), sessionToken: credentials.sessionToken.trim() });
      const identity: { account: string; arn: string } = JSON.parse(await this.native.loginAWS(region, value));
      if (typeof identity.account !== 'string' || typeof identity.arn !== 'string') throw new Error('aws_connection_failed');
      const previous = await this.vault.get(key);
      await this.vault.set(key, value);
      try {
        const item: AwsProfile = { key, name, region, enabled: profiles.find(p => p.key === key)?.enabled ?? true, account: identity.account, arn: identity.arn };
        await this.vault.set(indexKey, JSON.stringify([...profiles.filter(p => p.key !== key), item]));
      } catch (error) {
        if (previous === null) await this.vault.remove(key); else await this.vault.set(key, previous);
        throw error;
      }
      this.revision++;
    });
  }
  setEnabled(key: string, enabled: boolean): Promise<void> {
    return this.serial(async () => {
      const profiles = await this.list();
      if (!profiles.some(p => p.key === key)) throw new Error('aws_login_required');
      await this.vault.set(indexKey, JSON.stringify(profiles.map(p => p.key === key ? { ...p, enabled } : p)));
      this.revision++;
    });
  }
  remove(key: string): Promise<void> {
    return this.serial(async () => {
      const profiles = await this.list();
      if (!profiles.some(p => p.key === key)) return;
      const previous = await this.vault.get(key);
      await this.vault.remove(key);
      try { await this.vault.set(indexKey, JSON.stringify(profiles.filter(p => p.key !== key))); }
      catch (error) { if (previous !== null) await this.vault.set(key, previous); throw error; }
      this.revision++;
    });
  }
  async authorize(raw: string, eks: EksConfig): Promise<string> {
    await this.pending;
    const revision = this.revision;
    const profiles = await this.list();
    const profile = profiles.find(p => p.key === eks.credentialKey);
    if (!profile) throw new Error('aws_login_required');
    if (!profile.enabled) throw new Error('aws_profile_disabled');
    const credentials = await this.vault.get(profile.key);
    if (!credentials) throw new Error('aws_login_required');
    if (revision !== this.revision) throw new Error('aws_login_required');
    const resolved = await this.native.authorizeEKS(raw, credentials);
    // 停用、刪除或更新期間較晚回傳的 token 不交給 Kubernetes API。
    if (revision !== this.revision) throw new Error('aws_login_required');
    return resolved;
  }
}
