import type { CredentialStore, Credentials } from '../src/features/hosts/credentials.ts';

export const passwordAuth: Credentials = { type: 'password', password: 'test-only-password' };

export function memoryVault(): CredentialStore {
  const values = new Map<string, string>();
  return {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async key => { values.delete(key); },
  };
}

// 僅供測試的公開測試資料，不可用於實際主機。
export const testPrivateKey = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIAE50jV8XxUUUJTe9KGE8yPQxG2PFOzNdy9vLLFUOdVr\n-----END PRIVATE KEY-----\n";
