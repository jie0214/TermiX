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

