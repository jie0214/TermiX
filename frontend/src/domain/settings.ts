import type { ShortcutMap } from './shortcuts';

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
  /** Kubernetes 叢集探索用的 kubeconfig 路徑；空＝使用預設 ~/.kube/config。 */
  kubeconfigPath: string;
  /** Kubernetes 連線時的預設 namespace；profile／context 未指定時採用。 */
  defaultNamespace: string;
  /** 快捷鍵覆寫表（僅存與平台預設不同者）；"" 表示使用者停用該動作。 */
  shortcuts: ShortcutMap;
}

export interface SettingsState extends AppSettings {
  settingsModalOpen: boolean;
}

