export type Credentials =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; privateKey: string; passphrase: string };

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const maxPrivateKeyBytes = 32 * 1024;

export class CredentialValidationError extends Error {}

export function normalizeCredentials(value: Credentials): Credentials {
  if (value?.type === 'password') {
    if (typeof value.password !== 'string' || !value.password || value.password.length > 4096) throw new CredentialValidationError('請填寫登入密碼（上限 4096 字元）。');
    return { type: 'password', password: value.password };
  }
  if (value?.type === 'privateKey') {
    if (typeof value.passphrase !== 'string' || value.passphrase.length > 4096) throw new CredentialValidationError('私鑰密語不可超過 4096 字元。');
    return { type: 'privateKey', privateKey: normalizePrivateKey(value.privateKey), passphrase: value.passphrase };
  }
  throw new CredentialValidationError('請選擇密碼或 SSH 私鑰驗證。');
}

export function normalizePrivateKey(value: string): string {
  const key = value.trim().replace(/\r\n/g, '\n');
  const match = key.match(/^-----BEGIN ((?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY)-----\n([\s\S]+)\n-----END \1-----$/);
  if (!match || key.length > maxPrivateKeyBytes || !/^[\x20-\x7e\n]+$/.test(key)) {
    throw new CredentialValidationError('請選擇 OpenSSH 或 PEM 私鑰檔案（上限 32 KB），不可使用公鑰。');
  }
  return key + '\n';
}
