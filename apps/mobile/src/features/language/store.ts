import type { Storage } from '../hosts/repository.ts';
export const locales = ['zh-Hant', 'en', 'ja'] as const;
export type Locale = typeof locales[number];
export const languageNames: Record<Locale,string> = { 'zh-Hant': '繁體中文', en: 'English', ja: '日本語' };
interface LanguageState { locale: Locale; loaded: boolean; saving: boolean; error: string }
const key = 'termix.mobile.language.v1';
function valid(value: unknown): value is Locale { return locales.some(locale => locale === value); }
export class LanguageStore {
  private storage: Storage;
  private state: LanguageState = { locale: 'zh-Hant', loaded: false, saving: false, error: '' };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  constructor(storage: Storage) { this.storage = storage; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<LanguageState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }
  private async load() {
    try {
      const saved = await this.storage.getItem(key);
      if (saved !== null && !valid(saved)) throw new Error();
      this.update({ loaded: true, locale: saved ?? 'zh-Hant' });
    } catch { this.update({ loaded: true, error: '無法讀取語言設定，暫時使用繁體中文；原始設定已保留。' }); }
  }
  async change(locale: Locale): Promise<boolean> {
    if (!this.state.loaded || this.state.saving || !valid(locale)) return false;
    this.update({ saving: true, error: '' });
    try {
      await this.storage.setItem(key, locale);
      this.update({ locale, saving: false }); return true;
    } catch { this.update({ saving: false, error: '語言設定保存失敗，請重試。' }); return false; }
  }
}
