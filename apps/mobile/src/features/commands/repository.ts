import type { CredentialStore } from '../hosts/credentials.ts';

export type SavedCommand = { id: string; name: string; command: string };
const key = 'termix.commands.v1';
function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max &&
    !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
function validate(items: unknown): asserts items is SavedCommand[] {
  if (!Array.isArray(items) || items.length > 50 || JSON.stringify(items).length > 64_000 ||
    items.some(item => !item || !validText(item.id, 128) || !validText(item.name, 80) || !validText(item.command, 4093)) ||
    new Set(items.map(item => item.id)).size !== items.length) throw new Error('常用指令資料無效或超過容量。');
}

export class CommandRepository {
  private vault: CredentialStore;
  private makeId: () => string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(vault: CredentialStore, makeId: () => string) { this.vault = vault; this.makeId = makeId; }
  async list(): Promise<SavedCommand[]> {
    const raw = await this.vault.get(key);
    const items: unknown = raw ? JSON.parse(raw) : [];
    validate(items);
    return items;
  }
  private mutate(change: (items: SavedCommand[]) => SavedCommand[]) {
    const task = this.pending.then(async () => {
      const items = change(await this.list());
      validate(items);
      await this.vault.set(key, JSON.stringify(items));
      return items;
    });
    this.pending = task.catch(() => undefined);
    return task;
  }
  add(name: string, command: string) {
    return this.mutate(items => [...items, { id: this.makeId(), name: name.trim(), command }]);
  }
  remove(id: string) { return this.mutate(items => items.filter(item => item.id !== id)); }
}
