/**
 * 輕量多語系（i18n）核心。
 * - 英文為 base 與 fallback；缺字時回退 en，再回退 key 本身。
 * - 語言存於全域設定（termix-global-settings.locale），切換時 reload 套用。
 * - t(key, params) 支援 {name} 佔位符替換。
 *
 * 字典採「每模組一檔」結構（dict/*.ts），各檔匯出 { en, zhHant, ja } 三組物件，
 * 於此合併。新增模組字典：在此 import 並加入 BUNDLES 即可。
 */
import { common } from './dict/common.ts';
import { app } from './dict/app.ts';
import { hostvault } from './dict/hostvault.ts';
import { kubernetes } from './dict/kubernetes.ts';
import { terminal } from './dict/terminal.ts';
import { controlpanel } from './dict/controlpanel.ts';
import { misc } from './dict/misc.ts';

export const LOCALES = ['en', 'zh-Hant', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export interface DictBundle {
  en: Record<string, string>;
  zhHant: Record<string, string>;
  ja: Record<string, string>;
}

const BUNDLES: DictBundle[] = [common, app, hostvault, kubernetes, terminal, controlpanel, misc];

function assemble(key: keyof DictBundle): Record<string, string> {
  return Object.assign({}, ...BUNDLES.map((b) => b[key]));
}

const DICTS: Record<Locale, Record<string, string>> = {
  en: assemble('en'),
  'zh-Hant': assemble('zhHant'),
  ja: assemble('ja'),
};

function readInitialLocale(): Locale {
  try {
    const raw = localStorage.getItem('termix-global-settings');
    const value = raw ? (JSON.parse(raw).locale as string) : null;
    return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

let current: Locale = readInitialLocale();

export function getLocale(): Locale {
  return current;
}

/** 讓 t() 立即反映最新語言，並同步 <html lang>。 */
export function setActiveLocale(locale: string): void {
  if ((LOCALES as readonly string[]).includes(locale)) {
    current = locale as Locale;
    try {
      document.documentElement.lang = locale === 'zh-Hant' ? 'zh-Hant-TW' : locale;
    } catch {
      /* noop */
    }
  }
}

/** 翻譯。缺字回退：current → en → key。params 以 {name} 形式替換。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[current] || DICTS.en;
  let str = dict[key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const p of Object.keys(params)) {
      str = str.replace(new RegExp(`\\{${p}\\}`, 'g'), String(params[p]));
    }
  }
  return str;
}

setActiveLocale(current);
