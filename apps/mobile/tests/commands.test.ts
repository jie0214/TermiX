import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandRepository } from '../src/features/commands/repository.ts';
import { memoryVault } from './fixtures.ts';

test('常用指令可並行新增、重開讀回並刪除', async () => {
  const vault = memoryVault(); let id = 0;
  const repository = new CommandRepository(vault, () => String(++id));
  await Promise.all([repository.add('查看路徑', 'pwd'), repository.add('查看檔案', 'ls -la')]);
  const reopened = new CommandRepository(vault, () => String(++id));
  assert.deepEqual(await reopened.list(), [{ id: '1', name: '查看路徑', command: 'pwd' }, { id: '2', name: '查看檔案', command: 'ls -la' }]);
  await reopened.remove('1');
  assert.deepEqual(await repository.list(), [{ id: '2', name: '查看檔案', command: 'ls -la' }]);
});

test('拒絕空白、換行與控制碼；儲存失敗或資料損毀不覆蓋既有指令', async () => {
  const vault = memoryVault(); let id = 0;
  const repository = new CommandRepository(vault, () => String(++id));
  await repository.add('路徑', 'pwd');
  for (const command of ['', '  ', 'pwd\nrm -rf /', '\u001b[A', 'a'.repeat(4096)]) {
    await assert.rejects(repository.add('測試', command));
  }
  await assert.rejects(repository.add(' ', 'pwd'));
  const failed = new CommandRepository({ ...vault, set: async () => { throw new Error('vault unavailable'); } }, () => 'failed');
  await assert.rejects(failed.remove('1'));
  assert.equal((await repository.list()).length, 1);
  const damaged = new CommandRepository({ ...vault, get: async () => '{"unexpected":true}' }, () => 'bad');
  await assert.rejects(damaged.list());
  await assert.rejects(damaged.add('路徑', 'pwd'));
});
