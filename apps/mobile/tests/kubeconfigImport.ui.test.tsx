import * as DocumentPicker from 'expo-document-picker';
import { pickKubeconfig } from '../src/storage/kubeconfig';

const mockCleanup = jest.fn();
const mockFiles = new Map<string, { text: string; size: number; failRead?: boolean }>();
jest.mock('expo', () => ({ requireNativeModule: () => ({ clearSensitiveImportCopy: mockCleanup }) }));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.size ?? 0; }
    async text() {
      const file = mockFiles.get(this.uri);
      if (!file || file.failRead) throw new Error('read');
      return file.text;
    }
    delete() { mockFiles.delete(this.uri); }
  },
}));
beforeEach(() => { mockFiles.clear(); jest.clearAllMocks(); mockCleanup.mockResolvedValue(undefined); });

it.each(['success', 'oversized', 'readError', 'cleanupError'])('匯入 %s 清除快取與 iOS Inbox，清理失敗不回傳機密', async mode => {
  const uri = 'file:///cache/config';
  mockFiles.set(uri, { text: 'private-key', size: mode === 'oversized' ? 300000 : 500, failRead: mode === 'readError' });
  if (mode === 'cleanupError') mockCleanup.mockRejectedValue(new Error('cleanup'));
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [{ uri, name: 'config.yaml', lastModified: 0 }] });
  if (mode === 'success') expect(await pickKubeconfig()).toBe('private-key');
  else await expect(pickKubeconfig()).rejects.toThrow();
  expect(mockFiles.has(uri)).toBe(false);
  expect(mockCleanup).toHaveBeenCalledWith('config.yaml');
});
