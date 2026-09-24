import { catalog } from './catalog.ts';
import type { Locale } from './store.ts';
export type TranslationValues = Record<string, string | number>;
export function translate(locale: Locale, source: string, values: TranslationValues = {}): string {
  // 工作負載服務保留既有安全訊息；只有固定數字格式在顯示邊界轉為參數。
  const scale = /^叢集已接受期望副本數 (\d+)，不代表已就緒；請重新查詢。$/.exec(source);
  if (scale) return translate(locale, '叢集已接受期望副本數 {count}，不代表已就緒；請重新查詢。', { count: scale[1] });
  const entry = Object.hasOwn(catalog, source) ? catalog[source as keyof typeof catalog] : undefined;
  const text = locale === 'zh-Hant' || !entry ? source : entry[locale];
  return text.replace(/\{([a-zA-Z]+)\}/g, (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
