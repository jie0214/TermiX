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
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface AppSettings {
  theme: ThemeId;
  terminalTextSize: number;
  localTerminalPath: string;
}

export interface SettingsState extends AppSettings {
  settingsModalOpen: boolean;
}

