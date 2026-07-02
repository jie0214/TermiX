import type { WailsAppBindings } from './contracts';

export type WailsEventCallback = (...data: unknown[]) => void;
export type WailsEventOff = () => void;

export interface WailsRuntime {
  EventsEmit(eventName: string, ...data: unknown[]): void;
  EventsOn(eventName: string, callback: WailsEventCallback): WailsEventOff;
  EventsOnMultiple(
    eventName: string,
    callback: WailsEventCallback,
    maxCallbacks: number,
  ): WailsEventOff;
  EventsOnce(eventName: string, callback: WailsEventCallback): WailsEventOff;
  EventsOff(eventName: string, ...additionalEventNames: string[]): void;
  EventsOffAll(): void;
}

declare global {
  interface Window {
    go?: {
      app?: {
        App?: WailsAppBindings;
      };
    };
    runtime?: WailsRuntime;
  }
}
