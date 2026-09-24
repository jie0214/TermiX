import { maxPrivateKeyBytes } from '../features/hosts/credentials';
import { pickTextImport } from './textImport';
export function pickPrivateKey(): Promise<string | null> { return pickTextImport(maxPrivateKeyBytes); }
