import { pickTextImport } from './textImport';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { KubeStorage } from '../features/kubernetes/workspace';

const pointerKey = 'termix.kubeconfig.current';
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'termix.mobile.kubernetes',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
type Pointer = { file: string; key: string };
function parsePointer(raw: string): Pointer {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('file' in value) || !('key' in value) ||
    typeof value.file !== 'string' || !/^kubeconfig-[0-9a-f-]{36}\.enc$/.test(value.file) ||
    typeof value.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.key)) throw new Error('config_invalid');
  return value as Pointer;
}
function fileFor(name: string) { return new File(Paths.document, name); }
export const kubeconfigStorage: KubeStorage = {
  async load() {
    const raw = await SecureStore.getItemAsync(pointerKey, options);
    if (raw === null) return null;
    const pointer = parsePointer(raw);
    const file = fileFor(pointer.file);
    if (!file.exists || file.size > 400_000) throw new Error('config_invalid');
    const combined = await file.text();
    const key = await Crypto.AESEncryptionKey.import(pointer.key, 'base64');
    const decrypted = await Crypto.aesDecryptAsync(Crypto.AESSealedData.fromCombined(combined), key);
    return new TextDecoder().decode(decrypted);
  },
  async save(raw: string) {
    const oldRaw = await SecureStore.getItemAsync(pointerKey, options);
    const old = oldRaw === null ? null : parsePointer(oldRaw);
    const key = await Crypto.AESEncryptionKey.generate(256);
    const sealed = await Crypto.aesEncryptAsync(new TextEncoder().encode(raw), key);
    const pointer: Pointer = { file: `kubeconfig-${Crypto.randomUUID()}.enc`, key: await key.encoded('base64') };
    const file = fileFor(pointer.file);
    try {
      file.create();
      file.write(await sealed.combined('base64'));
      await SecureStore.setItemAsync(pointerKey, JSON.stringify(pointer), options);
    } catch (error) {
      if (file.exists) file.delete();
      throw error;
    }
    if (old) { const previous = fileFor(old.file); if (previous.exists) { try { previous.delete(); } catch { /* 加密舊副本無法由新金鑰解密。 */ } } }
  },
};

export function pickKubeconfig(): Promise<string | null> { return pickTextImport(256 * 1024); }
