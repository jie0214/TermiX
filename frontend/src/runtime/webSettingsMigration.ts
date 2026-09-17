import { migrateControlPanel } from './controlPanelMigration.ts';

const MARKER = 'termix-web-settings-bundle-migration-v1';
const LIST_KEYS = ['termix-snippets', 'termix-snippet-packages', 'termix-session-logs'];
const OBJECT_KEYS = ['termix-global-settings', 'termix-hostvault-view-prefs', 'termix-kubernetes-view-prefs'];

export async function migrateWebSettings(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  readLegacy?: () => Promise<Record<string, string>>,
): Promise<void> {
  if (!readLegacy || storage.getItem(MARKER) === 'done') return;
  const legacy = await readLegacy();
  // 先完成組件遷移，避免主機正規化以空清單清除掛載。
  await migrateControlPanel(storage, async () => legacy['termix-custom-components'] ?? '');
  for (const key of [...LIST_KEYS, ...OBJECT_KEYS, 'control-sidebar-width']) {
    const raw = legacy[key];
    if (!raw) continue;
    const current = storage.getItem(key);
    if (key === 'control-sidebar-width') {
      if (current === null && /^\d+(?:\.\d+)?px$/.test(raw)) storage.setItem(key, raw);
      continue;
    }
    const value = JSON.parse(raw);
    if (LIST_KEYS.includes(key)) {
      if (!Array.isArray(value)) throw new Error('舊版清單設定格式異常，停止遷移。');
      const existing = current === null ? [] : JSON.parse(current);
      if (!Array.isArray(existing)) throw new Error('目前清單設定格式異常，停止遷移。');
      // 既有清單以 ID 保留新版修改；沒有 ID 的歷史項目只在首次安裝時複製。
      const ids = new Set(existing.map(item => item?.id));
      const merged = current === null ? value : [...existing, ...value.filter(item => item?.id && !ids.has(item.id))];
      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        if (storage.getItem(`${MARKER}-backup-${key}`) === null) {
          storage.setItem(`${MARKER}-backup-${key}`, current ?? 'null');
        }
        storage.setItem(key, JSON.stringify(merged));
      }
    } else {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('舊版偏好設定格式異常，停止遷移。');
      // 不推測 v1.8.1 中的偏好是否由使用者更改，既有值一律優先。
      if (current === null) storage.setItem(key, raw);
    }
  }
  storage.setItem(MARKER, 'done');
}
