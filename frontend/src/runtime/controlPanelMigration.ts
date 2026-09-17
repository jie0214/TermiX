const COMPONENTS_KEY = 'termix-custom-components';
const MIGRATION_KEY = 'termix-control-panel-bundle-migration-v1';

type Component = { id: string; type: string; [key: string]: unknown };

function parseComponents(raw: string): Component[] {
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.some(value => !value || typeof value.id !== 'string'
    || !value.id || !['info', 'switch', 'function'].includes(value.type))) {
    throw new Error('Control Panel 設定格式異常，停止遷移以保留原始資料。');
  }
  return values;
}

// 在主機與組件 Store 載入前完成，避免空清單清除原有掛載關係。
export async function migrateControlPanel(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  readLegacy?: () => Promise<string>,
): Promise<void> {
  if (!readLegacy || storage.getItem(MIGRATION_KEY) === 'done') return;
  const legacyRaw = await readLegacy();
  if (legacyRaw) {
    const legacy = parseComponents(legacyRaw);
    const currentRaw = storage.getItem(COMPONENTS_KEY);
    const current = currentRaw ? parseComponents(currentRaw) : [];
    const ids = new Set(current.map(value => value.id));
    const missing = legacy.filter(value => !ids.has(value.id));
    if (missing.length) {
      // 寫入前保留新版原始資料，舊版資料庫則維持唯讀。
      storage.setItem(`${MIGRATION_KEY}-backup`, currentRaw ?? 'null');
      storage.setItem(COMPONENTS_KEY, JSON.stringify([...current, ...missing]));
    }
  }
  storage.setItem(MIGRATION_KEY, 'done');
}
