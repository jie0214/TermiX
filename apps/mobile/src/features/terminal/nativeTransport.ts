import { requireNativeModule } from 'expo';
import type { SSHEvent, SSHTransport } from './contracts';

interface NativeSSH {
  start(config: string): Promise<void>;
  poll(id: string): Promise<string>;
  trust(id: string, accept: boolean): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  disconnect(id: string): Promise<void>;
}
const native = requireNativeModule<NativeSSH>('TermixSSH');
export const nativeTransport: SSHTransport = {
  start: config => native.start(JSON.stringify(config)),
  poll: async id => JSON.parse(await native.poll(id)) as SSHEvent[],
  trust: (id, accept) => native.trust(id, accept),
  write: (id, data) => native.write(id, data),
  resize: (id, cols, rows) => native.resize(id, cols, rows),
  disconnect: id => native.disconnect(id),
};
