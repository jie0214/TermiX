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

