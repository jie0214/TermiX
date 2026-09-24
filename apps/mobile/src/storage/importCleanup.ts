import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { File } from 'expo-file-system';

// 呼叫端只傳入檔案選擇器產生的 App 快取；原生端另限定 UIKit Inbox。
export async function clearImportCopies(file: File, name: string): Promise<void> {
  try { if (file.exists) file.delete(); }
  finally {
    if (Platform.OS === 'ios') {
      await requireNativeModule<{ clearSensitiveImportCopy(name: string): Promise<void> }>('TermixSSH')
        .clearSensitiveImportCopy(name);
    }
  }
}
