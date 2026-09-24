import { pickTextImport } from './textImport';
export function pickMobileSettings(): Promise<string | null> { return pickTextImport(256 * 1024); }
