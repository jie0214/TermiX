export const THEME_IDS = [
  'system',
  'light',
  'dark',
  'purple-dark',
  'termix',
  'tahoe',
  'graphite',
  'forest',
  'copper',
  'aurora',
  'tahoe-glacier',
  'tahoe-sunset',
  'tahoe-nebula',
  'tahoe-forest',
  'glass-light',
  'glass-dark',
  'glass-violet',
  'glass-emerald',
  'glass-amber',
  'glass-rose',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const LOCALE_IDS = ['en', 'zh-Hant', 'ja'] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

export interface AppSettings {
  theme: ThemeId;
  terminalTextSize: number;
  localTerminalPath: string;
  locale: LocaleId;
}

export interface SettingsState extends AppSettings {
  settingsModalOpen: boolean;
}

