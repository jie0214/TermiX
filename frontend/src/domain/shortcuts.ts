// 快捷鍵領域模型：唯一事實來源（動作註冊表）＋ 綁定字串的純函式。
//
// 綁定字串採「字面修飾鍵」正規形式，直接對應 KeyboardEvent 的布林旗標：
//   修飾鍵 token：Meta / Ctrl / Alt / Shift（固定順序），主鍵 token 一個，以 '+' 串接。
//   例："Meta+C"、"Ctrl+Shift+]"、"Meta+Alt+S"。空字串 "" 代表「停用」。
//
// 之所以不用平台無關的 "Mod" 抽象：mac 與 win/linux 的預設本質不同（mac 複製為 ⌘C，
// win/linux 複製為 Ctrl+Shift+C，裸 Ctrl+C/X/V 保留給 PTY），並非單純 ⌘↔Ctrl 對調。
// 字面修飾鍵讓 dispatcher 可用「eventToBinding(e) === 綁定」直接比對，單一產生器、無歧義。

export type Platform = 'mac' | 'other';

/** 平台無關的綁定字串（正規形式），"" 表示停用。 */
export type KeyBinding = string;

/** 動作 id → 綁定的覆寫表；僅存與預設不同者。 */
export type ShortcutMap = Record<string, KeyBinding>;

export interface ShortcutAction {
  id: string;
  /** i18n key（於 shortcuts 分頁顯示，第 6 步補齊三語）。 */
  labelKey: string;
  /** 分組（對應設定頁分區），對齊參考截圖的 Terminal / Tabs / App 概念。 */
  category: 'tabs' | 'terminal' | 'app';
  /** 各平台預設綁定；作者手寫，須與 eventToBinding 的輸出同形。 */
  defaults: Record<Platform, KeyBinding>;
}

// 固定的修飾鍵正規順序。
const MODIFIER_ORDER = ['Meta', 'Ctrl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER);
// 「主要」修飾鍵：合法快捷鍵至少需含其一（僅 Shift 會癱瘓終端輸入，不可單獨作為快捷鍵）。
const PRIMARY_MODIFIERS = new Set<string>(['Meta', 'Ctrl', 'Alt']);

/**
 * 動作註冊表。僅收錄 TermiX 已具備對應能力的動作（handler 於第 3 步接上）；
 * 新增動作時於此追加，設定頁與 dispatcher 皆讀此表。
 */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  {
    id: 'nextTab',
    labelKey: 'shortcut.action.nextTab',
    category: 'tabs',
    defaults: { mac: 'Meta+Shift+]', other: 'Ctrl+Shift+]' },
  },
  {
    id: 'prevTab',
    labelKey: 'shortcut.action.prevTab',
    category: 'tabs',
    defaults: { mac: 'Meta+Shift+[', other: 'Ctrl+Shift+[' },
  },
  {
    id: 'closeTab',
    labelKey: 'shortcut.action.closeTab',
    category: 'tabs',
    // Ctrl+W 於 shell 為刪除單字，保留給 PTY，故 other 用 Ctrl+Shift+W。
    defaults: { mac: 'Meta+W', other: 'Ctrl+Shift+W' },
  },
  {
    id: 'copy',
    labelKey: 'shortcut.action.copy',
    category: 'terminal',
    defaults: { mac: 'Meta+C', other: 'Ctrl+Shift+C' },
  },
  {
    id: 'paste',
    labelKey: 'shortcut.action.paste',
    category: 'terminal',
    defaults: { mac: 'Meta+V', other: 'Ctrl+Shift+V' },
  },
  {
    id: 'selectAll',
    labelKey: 'shortcut.action.selectAll',
    category: 'terminal',
    // Ctrl+A 於 shell 為移到行首，保留給 PTY，故 other 用 Ctrl+Shift+A。
    defaults: { mac: 'Meta+A', other: 'Ctrl+Shift+A' },
  },
  {
    id: 'newLocalTerminal',
    labelKey: 'shortcut.action.newLocalTerminal',
    category: 'app',
    // Ctrl+L 於 shell 為清畫面，保留給 PTY，故 other 用 Ctrl+Shift+L。
    defaults: { mac: 'Meta+L', other: 'Ctrl+Shift+L' },
  },
  {
    id: 'openSnippets',
    labelKey: 'shortcut.action.openSnippets',
    category: 'app',
    // 收編既有的 handleSnippetShortcut（Cmd/Ctrl + .）。
    defaults: { mac: 'Meta+.', other: 'Ctrl+.' },
  },
  {
    id: 'openSettings',
    labelKey: 'shortcut.action.openSettings',
    category: 'app',
    defaults: { mac: 'Meta+,', other: 'Ctrl+,' },
  },
];

const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));

// 「跳到第 N 個分頁」特例：語意為「主修飾鍵 + 數字 1..9」，與單一組合的相等比對不同，
// 且非固定主鍵，故獨立於註冊表建模（第 3 步固定前綴、暫不開放重新綁定）。
export const TAB_INDEX_ACTION_ID = 'focusTabByIndex';

/** 偵測目前平台；在 Wails/瀏覽器 renderer 讀 navigator，無法判斷時回傳 'other'。 */
export function detectPlatform(): Platform {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const raw =
    (nav && (nav as any).userAgentData?.platform) ||
    (nav && nav.platform) ||
    '';
  return /mac|iphone|ipad|ipod/i.test(String(raw)) ? 'mac' : 'other';
}

// event.code → 正規主鍵 token。用 code 而非 key 以避免 Shift 改變字元（如 Shift+] → "}"）造成的佈局相依問題。
function normalizeCode(code: string, key: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const map: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Period: '.',
    Comma: ',',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  if (map[code]) return map[code];
  // 後備：用 key（單字元轉大寫），涵蓋未列舉的實體鍵。
  if (key && key.length === 1) return key.toUpperCase();
  return key || code || '';
}

/**
 * 將 KeyboardEvent 正規化為綁定字串。
 * 純修飾鍵按下、或缺少主要修飾鍵（Meta/Ctrl/Alt）時回傳 null（非合法快捷鍵）。
 */
export function eventToBinding(event: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): KeyBinding | null {
  // 忽略單獨的修飾鍵按下。
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;

  const mods: Modifier[] = [];
  if (event.metaKey) mods.push('Meta');
  if (event.ctrlKey) mods.push('Ctrl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');

  if (!mods.some((m) => PRIMARY_MODIFIERS.has(m))) return null;

  const mainKey = normalizeCode(event.code, event.key);
  if (!mainKey) return null;

  return [...mods, mainKey].join('+');
}

/** 綁定字串是否為可用組合（>=1 主要修飾鍵 + 恰一個主鍵）。"" 與非法皆回傳 false。 */
export function isValidBinding(binding: KeyBinding): boolean {
  if (!binding) return false;
  const tokens = binding.split('+');
  const mods = tokens.filter((t) => MODIFIER_SET.has(t));
  const keys = tokens.filter((t) => !MODIFIER_SET.has(t));
  if (keys.length !== 1 || !keys[0]) return false;
  return mods.some((m) => PRIMARY_MODIFIERS.has(m));
}

// 顯示用 token 對照：修飾鍵於 mac 用符號，其餘平台用文字。
const DISPLAY_MODIFIER: Record<Platform, Record<Modifier, string>> = {
  mac: { Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' },
  other: { Meta: 'Win', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' },
};
const DISPLAY_KEY: Record<string, string> = {
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Space: 'Space',
};

/** 將綁定字串拆成顯示 token 陣列（供設定頁渲染 <kbd> 鍵帽）；停用回傳 []。 */
export function bindingToTokens(binding: KeyBinding, platform: Platform): string[] {
  if (!binding) return [];
  return binding.split('+').map((token) => {
    if (MODIFIER_SET.has(token)) return DISPLAY_MODIFIER[platform][token as Modifier];
    return DISPLAY_KEY[token] ?? token;
  });
}

/** 綁定字串的可讀顯示形式；停用回傳空字串。 */
export function renderBinding(binding: KeyBinding, platform: Platform): string {
  return bindingToTokens(binding, platform).join(platform === 'mac' ? ' ' : '+');
}

/** 解析單一動作的生效綁定：覆寫優先（含 "" 表使用者停用），否則取平台預設。 */
export function resolveBinding(
  actionId: string,
  overrides: ShortcutMap,
  platform: Platform
): KeyBinding {
  if (Object.prototype.hasOwnProperty.call(overrides ?? {}, actionId)) {
    return overrides[actionId];
  }
  return ACTION_BY_ID.get(actionId)?.defaults[platform] ?? '';
}

export interface ShortcutMatch {
  actionId: string;
  /** 僅 focusTabByIndex 時提供：1..9。 */
  index?: number;
}

/**
 * 將按鍵事件比對到動作。純函式，供 dispatcher 與測試共用。
 *   1) 分頁數字跳轉特例：<主修飾鍵> + 1..9（mac 用 ⌘、其餘用 Ctrl；不含 Alt/Shift）。
 *   2) 一般組合：eventToBinding(event) 與生效表逐一比對。
 * 未命中回傳 null。
 */
export function matchShortcut(
  event: {
    key: string;
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  resolvedMap: ShortcutMap,
  platform: Platform
): ShortcutMatch | null {
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit && !event.altKey && !event.shiftKey) {
    const wantMeta = platform === 'mac';
    if (event.metaKey === wantMeta && event.ctrlKey === !wantMeta) {
      return { actionId: TAB_INDEX_ACTION_ID, index: Number(digit[1]) };
    }
  }

  const binding = eventToBinding(event);
  if (!binding) return null;
  for (const [actionId, b] of Object.entries(resolvedMap)) {
    if (b && b === binding) return { actionId };
  }
  return null;
}

/**
 * 正規化持久化的覆寫表：僅保留已知動作 id、且值為合法組合或空字串（停用）者；
 * 丟棄未知鍵與非字串／非法值。回傳全新物件，不變動輸入。
 */
export function normalizeShortcutMap(input: unknown): ShortcutMap {
  const out: ShortcutMap = {};
  if (!input || typeof input !== 'object') return out;
  const source = input as Record<string, unknown>;
  for (const action of SHORTCUT_ACTIONS) {
    const value = source[action.id];
    if (typeof value !== 'string') continue;
    if (value === '' || isValidBinding(value)) out[action.id] = value;
  }
  return out;
}

/** 解析全部動作的生效綁定表（供 dispatcher 與設定頁使用）。 */
export function resolveShortcuts(
  overrides: ShortcutMap,
  platform: Platform
): ShortcutMap {
  const resolved: ShortcutMap = {};
  for (const action of SHORTCUT_ACTIONS) {
    resolved[action.id] = resolveBinding(action.id, overrides, platform);
  }
  return resolved;
}
