import type {
  WailsAppBindings,
  WailsAppContract,
  WailsAppMethodName,
} from './contracts';
import { t } from '../../i18n/index.ts';

export function getAppBindings(): WailsAppBindings | undefined {
  return globalThis.window?.go?.app?.App;
}

export function getAppBinding<TName extends WailsAppMethodName>(
  methodName: TName,
): WailsAppContract[TName] | undefined;
export function getAppBinding<TMethod extends (...args: any[]) => any>(
  methodName: string,
): TMethod | undefined;
export function getAppBinding(
  methodName: string,
): ((...args: any[]) => any) | undefined {
  const binding = getAppBindings()?.[methodName];
  return typeof binding === 'function' ? binding : undefined;
}

export function requireAppBinding<TName extends WailsAppMethodName>(
  methodName: TName,
): WailsAppContract[TName];
export function requireAppBinding<TMethod extends (...args: any[]) => any>(
  methodName: string,
): TMethod;
export function requireAppBinding(
  methodName: string,
): (...args: any[]) => any {
  const binding = getAppBinding(methodName);
  if (!binding) {
    throw new Error(t('misc.wails.missingBinding', { name: methodName }));
  }
  return binding;
}

export function hasWailsBindings(): boolean {
  return Boolean(getAppBindings());
}
