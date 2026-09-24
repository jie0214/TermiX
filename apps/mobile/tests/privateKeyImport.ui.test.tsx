import * as DocumentPicker from 'expo-document-picker';
import { pickPrivateKey } from '../src/storage/privateKeyImport';
import { testPrivateKey } from './fixtures';

const mockCleanup = jest.fn();
jest.mock('expo', () => ({ requireNativeModule: () => ({ clearSensitiveImportCopy: mockCleanup }) }));
const mockFiles = new Map<string, { text: string; size: number; failRead?: boolean }>();
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

it('取消匯入不讀取或刪除來源檔案', async () => {
  mockFiles.set('file:///documents/key', { text: testPrivateKey, size: 500 });
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
  expect(await pickPrivateKey()).toBeNull();
  expect(mockFiles.has('file:///documents/key')).toBe(true);
});

it.each(['success', 'oversized', 'readError', 'cleanupError'])('匯入 %s 後清除應用程式私鑰暫存', async mode => {
  const uri = 'file:///cache/key';
  if (mode === 'cleanupError') mockCleanup.mockRejectedValue(new Error('cleanup'));
  mockFiles.set(uri, { text: testPrivateKey, size: mode === 'oversized' ? 40000 : 500, failRead: mode === 'readError' });
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [{ uri, name: 'key', lastModified: 0 }] });
  if (mode === 'success') expect(await pickPrivateKey()).toBe(testPrivateKey);
  else await expect(pickPrivateKey()).rejects.toThrow();
  expect(mockFiles.has(uri)).toBe(false);
  expect(mockCleanup).toHaveBeenCalledWith('key');
});

it('不刪除快取以外的使用者原始檔案', async () => {
  const uri = 'file:///documents/key';
  mockFiles.set(uri, { text: testPrivateKey, size: 500 });
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [{ uri, name: 'key', lastModified: 0 }] });
  await expect(pickPrivateKey()).rejects.toThrow();
  expect(mockFiles.has(uri)).toBe(true);
});
