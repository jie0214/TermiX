import { createStore } from 'zustand/vanilla';
import { HostAPI } from '../modules/hostvault/HostAPI';
import { LOCALES, DEFAULT_LOCALE, setActiveLocale } from '../i18n/index.ts';

const GLOBAL_SETTINGS_KEY = 'termix-global-settings';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  terminalTextSize: 12.5,
  localTerminalPath: '/bin/zsh',
  locale: DEFAULT_LOCALE
};
const THEME_OPTIONS = ['system', 'light', 'dark', 'purple-dark', 'termix', 'tahoe', 'graphite', 'forest', 'copper', 'aurora', 'tahoe-glacier', 'tahoe-sunset', 'tahoe-nebula', 'tahoe-forest', 'glass-light', 'glass-dark', 'glass-violet', 'glass-emerald', 'glass-amber', 'glass-rose'];

export function normalizeTerminalTextSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.terminalTextSize;
  return Math.min(24, Math.max(9, Math.round(parsed * 2) / 2));
}

function normalizeSettings(settings = {}) {
  return {
    theme: THEME_OPTIONS.includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    terminalTextSize: normalizeTerminalTextSize(settings.terminalTextSize ?? DEFAULT_SETTINGS.terminalTextSize),
    localTerminalPath: String(settings.localTerminalPath || DEFAULT_SETTINGS.localTerminalPath).trim() || DEFAULT_SETTINGS.localTerminalPath,
    locale: LOCALES.includes(settings.locale) ? settings.locale : DEFAULT_SETTINGS.locale
  };
}

function saveSettings(settings) {
  localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
}

function readLocalSettings() {
  const data = localStorage.getItem(GLOBAL_SETTINGS_KEY);
  return normalizeSettings(data ? JSON.parse(data) : DEFAULT_SETTINGS);
}

export const themeStore = createStore((set, get) => ({
  theme: DEFAULT_SETTINGS.theme,
  terminalTextSize: DEFAULT_SETTINGS.terminalTextSize,
  localTerminalPath: DEFAULT_SETTINGS.localTerminalPath,
  locale: DEFAULT_SETTINGS.locale,
  settingsModalOpen: false,

  loadSettings: async () => {
    try {
      const settings = normalizeSettings(await HostAPI.getAppSettings());
      saveSettings(settings);
      set(settings);
      applyTheme(settings.theme);
      setActiveLocale(settings.locale);
    } catch (backendError) {
      try {
        const settings = readLocalSettings();
        set(settings);
        applyTheme(settings.theme);
        setActiveLocale(settings.locale);
      } catch (localError) {
        set(DEFAULT_SETTINGS);
        applyTheme(DEFAULT_SETTINGS.theme);
        setActiveLocale(DEFAULT_SETTINGS.locale);
      }
    }
  },

  setLocale: async (locale) => {
    const next = normalizeSettings({ ...get(), locale });
    set(next);
    saveSettings(next);
    try {
      await HostAPI.saveAppSettings(next);
    } catch (e) {
      console.error('[TermiX] SaveAppSettings(locale) 失敗，已暫存於本機', e);
    }
    // 語言切換影響所有已渲染 UI，reload 以套用（t() 於載入時讀取新 locale）
    window.location.reload();
  },

  setTheme: async (theme) => {
    const next = normalizeSettings({ ...get(), theme });
    set(next);
    saveSettings(next);
    applyTheme(next.theme);
    try {
      await HostAPI.saveAppSettings(next);
    } catch (e) {
      console.error('[TermiX] SaveAppSettings(theme) 失敗，已暫存於本機', e);
    }
  },

  setTerminalTextSize: async (terminalTextSize) => {
    const next = normalizeSettings({ ...get(), terminalTextSize });
    set(next);
    saveSettings(next);
    try {
      await HostAPI.saveAppSettings(next);
    } catch (e) {
      console.error('[TermiX] SaveAppSettings(text size) 失敗，已暫存於本機', e);
    }
  },

  saveSettings: async ({ theme, terminalTextSize, localTerminalPath }) => {
    const next = normalizeSettings({ ...get(), theme, terminalTextSize, localTerminalPath });
    set(next);
    saveSettings(next);
    applyTheme(next.theme);
    try {
      await HostAPI.saveAppSettings(next);
    } catch (e) {
      console.error('[TermiX] SaveAppSettings 失敗，已暫存於本機', e);
    }
  },

  setSettingsModalOpen: (settingsModalOpen) => set({ settingsModalOpen })
}));

// --- 系統配色跟隨邏輯 ---

/** 當前系統偏好 media query listener，僅在 theme === 'system' 時啟用 */
let systemMQListener = null;
const systemMQ = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * 取得目前生效的底層主題 ID。
 * 當 theme === 'system' 時依系統偏好回傳 'system-dark' 或 'light'。
 */
export function getEffectiveTheme(theme) {
  if (theme !== 'system') return theme;
  return systemMQ.matches ? 'system-dark' : 'light';
}

function applyTheme(theme) {
  // 移除舊的 system media query 監聽器（切換離開 system 主題時清理）
  if (systemMQListener) {
    systemMQ.removeEventListener('change', systemMQListener);
    systemMQListener = null;
  }

  if (theme === 'system') {
    // 立即依系統偏好套用（深色模式 → system-dark 黑灰調）
    applyThemeClass(systemMQ.matches ? 'system-dark' : 'light');
    // 監聴系統配色變化
    systemMQListener = (e) => {
      applyThemeClass(e.matches ? 'system-dark' : 'light');
      // 透過更新 _systemTs 觸發所有 themeStore 訂閱者（例如 TerminalPage 的 xterm 配色更新）
      themeStore.setState((s) => ({ ...s, _systemTs: Date.now() }));
    };
    systemMQ.addEventListener('change', systemMQListener);
  } else {
    applyThemeClass(theme);
  }
}

function applyThemeClass(normalizedTheme) {
  const root = document.documentElement;
  // 動態清除既有主題 class（含 dark-theme 與所有 theme-*），避免新增主題時漏改硬編碼清單
  [...root.classList]
    .filter((c) => c === 'dark-theme' || c.startsWith('theme-'))
    .forEach((c) => root.classList.remove(c));
  root.classList.toggle('dark-theme', normalizedTheme !== 'light');
  if (normalizedTheme !== 'light' && normalizedTheme !== 'dark') {
    root.classList.add(`theme-${normalizedTheme}`);
  }
}
