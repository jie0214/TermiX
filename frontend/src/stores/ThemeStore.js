import { createStore } from 'zustand/vanilla';
import { HostAPI } from '../modules/hostvault/HostAPI';
import { LOCALES, DEFAULT_LOCALE, setActiveLocale } from '../i18n/index.ts';
import { normalizeShortcutMap } from '../domain/shortcuts.ts';

const GLOBAL_SETTINGS_KEY = 'termix-global-settings';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  terminalTextSize: 12.5,
  localTerminalPath: '/bin/zsh',
  locale: DEFAULT_LOCALE,
  uiScale: 1,
  shortcuts: {}
};
const THEME_OPTIONS = ['system', 'light', 'dark', 'purple-dark', 'termix', 'tahoe', 'graphite', 'forest', 'copper', 'aurora', 'tahoe-glacier', 'tahoe-sunset', 'tahoe-nebula', 'tahoe-forest', 'glass-light', 'glass-dark', 'glass-violet', 'glass-emerald', 'glass-amber', 'glass-rose'];
// UI 介面縮放的分段預設（90% / 100% / 110% / 125%）。整體 UI 以 CSS zoom 等比縮放，
// 終端機畫面另以 1/scale 反向縮放維持獨立（見 style.css .xterm-pane-container）。
export const UI_SCALE_OPTIONS = [0.9, 1, 1.1, 1.25];

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
    locale: LOCALES.includes(settings.locale) ? settings.locale : DEFAULT_SETTINGS.locale,
    uiScale: UI_SCALE_OPTIONS.includes(Number(settings.uiScale)) ? Number(settings.uiScale) : DEFAULT_SETTINGS.uiScale,
    shortcuts: normalizeShortcutMap(settings.shortcuts)
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
  uiScale: DEFAULT_SETTINGS.uiScale,
  shortcuts: {},
  settingsModalOpen: false,

  loadSettings: async () => {
    try {
      const settings = normalizeSettings(await HostAPI.getAppSettings());
      saveSettings(settings);
      set(settings);
      applyTheme(settings.theme);
      applyUiScale(settings.uiScale);
      setActiveLocale(settings.locale);
    } catch (backendError) {
      try {
        const settings = readLocalSettings();
        set(settings);
        applyTheme(settings.theme);
        applyUiScale(settings.uiScale);
        setActiveLocale(settings.locale);
      } catch (localError) {
        set(DEFAULT_SETTINGS);
        applyTheme(DEFAULT_SETTINGS.theme);
        applyUiScale(DEFAULT_SETTINGS.uiScale);
        setActiveLocale(DEFAULT_SETTINGS.locale);
      }
    }
  },

  setLocale: async (locale) => {
    // 主題以「已落地」的值為準（讀 localStorage），避免把設定視窗中未儲存的預覽主題
    // 因切換語言而一併寫入。textSize/localTerminalPath 未被預覽改動，沿用 get() 即可。
    const savedTheme = readLocalSettings().theme;
    const next = normalizeSettings({ ...get(), theme: savedTheme, locale });
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

  // 僅即時套用主題（含記憶體 state，讓 xterm 等訂閱者同步換色），不寫入 localStorage 或後端。
  // 供設定視窗「預覽」用：按儲存才呼叫 saveSettings 落地，按取消則 previewTheme 回原值即可還原。
  previewTheme: (theme) => {
    const next = THEME_OPTIONS.includes(theme) ? theme : get().theme;
    set({ theme: next });
    applyTheme(next);
  },

  // UI 介面縮放：即時套用並持久化。落地時 theme 以「已儲存值」為準、且不動記憶體中的 theme，
  // 避免夾帶或覆蓋設定視窗內未儲存的主題預覽。
  setUiScale: async (uiScale) => {
    const scale = normalizeSettings({ ...get(), uiScale }).uiScale;
    set({ uiScale: scale });
    applyUiScale(scale);
    const persisted = normalizeSettings({ ...get(), theme: readLocalSettings().theme });
    saveSettings(persisted);
    try {
      await HostAPI.saveAppSettings(persisted);
    } catch (e) {
      console.error('[TermiX] SaveAppSettings(uiScale) 失敗，已暫存於本機', e);
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

  // 快捷鍵覆寫表：即時套用並持久化。theme 以「已儲存值」為準，避免夾帶設定視窗內未儲存的主題預覽。
  setShortcuts: async (shortcuts) => {
    const normalized = normalizeShortcutMap(shortcuts);
    set({ shortcuts: normalized });
    const persisted = normalizeSettings({ ...get(), shortcuts: normalized, theme: readLocalSettings().theme });
    saveSettings(persisted);
    try {
      await HostAPI.saveAppSettings(persisted);
    } catch (e) {
      console.error('[TermiX] SaveAppSettings(shortcuts) 失敗，已暫存於本機', e);
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

// 於 :root 設 --ui-scale；實際縮放由 .shell 的 zoom: var(--ui-scale) 套用（見 style.css）。
// 縮放 .shell（而非 html）並將 .shell 尺寸設為 calc(100vX / scale)，縮放後剛好填滿視窗、
// 不會像 zoom html 那樣讓 100vh/100vw 版面溢出被裁切。終端機容器再以 1/scale 反向相消維持獨立。
function applyUiScale(scale) {
  const value = UI_SCALE_OPTIONS.includes(Number(scale)) ? Number(scale) : DEFAULT_SETTINGS.uiScale;
  document.documentElement.style.setProperty('--ui-scale', String(value));
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
