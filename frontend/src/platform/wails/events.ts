import type { WailsEventCallback, WailsEventOff, WailsRuntime } from './types';

function getRuntime(): WailsRuntime | undefined {
  return globalThis.window?.runtime;
}

export function onWailsEvent(
  eventName: string,
  callback: WailsEventCallback,
): WailsEventOff {
  return getRuntime()?.EventsOn(eventName, callback) ?? (() => undefined);
}

export function onceWailsEvent(
  eventName: string,
  callback: WailsEventCallback,
): WailsEventOff {
  return getRuntime()?.EventsOnce(eventName, callback) ?? (() => undefined);
}

export function emitWailsEvent(eventName: string, ...data: unknown[]): void {
  getRuntime()?.EventsEmit(eventName, ...data);
}

export function offWailsEvent(
  eventName: string,
  ...additionalEventNames: string[]
): void {
  getRuntime()?.EventsOff(eventName, ...additionalEventNames);
}

// 讀取系統剪貼簿文字。優先用 Wails 原生 runtime（WKWebView 的 navigator.clipboard.readText
// 常因權限被擋，導致「複製正常、貼上失效」），失敗才退回 navigator.clipboard。
export async function getClipboardText(): Promise<string> {
  const runtime = getRuntime();
  if (runtime && typeof runtime.ClipboardGetText === 'function') {
    try {
      const text = await runtime.ClipboardGetText();
      if (typeof text === 'string') return text;
    } catch {
      // 落到 navigator 後備。
    }
  }
  try {
    return (await globalThis.navigator?.clipboard?.readText?.()) ?? '';
  } catch {
    return '';
  }
}

// 寫入系統剪貼簿文字。優先用 Wails 原生 runtime，退回 navigator.clipboard。
export async function setClipboardText(text: string): Promise<void> {
  const value = String(text ?? '');
  const runtime = getRuntime();
  if (runtime && typeof runtime.ClipboardSetText === 'function') {
    try {
      await runtime.ClipboardSetText(value);
      return;
    } catch {
      // 落到 navigator 後備。
    }
  }
  try {
    await globalThis.navigator?.clipboard?.writeText?.(value);
  } catch {
    // 無可用剪貼簿通道時靜默略過。
  }
}

// 以系統預設瀏覽器開啟外部連結；非 Wails（瀏覽器）環境退回 window.open。
export function openBrowserURL(url: string): void {
  const target = String(url || '').trim();
  if (!target) return;
  const runtime = getRuntime();
  if (runtime && typeof runtime.BrowserOpenURL === 'function') {
    runtime.BrowserOpenURL(target);
    return;
  }
  globalThis.window?.open?.(target, '_blank', 'noopener');
}

