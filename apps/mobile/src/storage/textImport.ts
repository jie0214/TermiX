import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { clearImportCopies } from './importCleanup';

// 即使選錯含機密的檔案，也清除 App 快取與 iOS Inbox，不碰來源檔。
export async function pickTextImport(maxBytes: number): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (!file.uri.startsWith(Paths.cache.uri)) throw new Error('invalid_import');
  try {
    if ((asset.size ?? file.size) > maxBytes || file.size > maxBytes) throw new Error('import_too_large');
    return await file.text();
  } finally { await clearImportCopies(file, asset.name); }
}
