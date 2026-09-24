import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CommandProvider } from '../src/features/commands/CommandProvider';
import { CommandSettings } from '../src/features/commands/CommandSettings';
import { CommandRepository } from '../src/features/commands/repository';
import { memoryVault } from './fixtures';

test('設定可新增指令，刪除前可取消，確認後清單更新', async () => {
  const repository = new CommandRepository(memoryVault(), () => 'command');
  await render(<CommandProvider repository={repository}><CommandSettings /></CommandProvider>);
  await screen.findByText('尚無常用指令');
  await fireEvent.changeText(screen.getByLabelText('指令名稱'), '查看路徑');
  await fireEvent.changeText(screen.getByLabelText('指令內容'), 'pwd');
  await fireEvent.press(screen.getByRole('button', { name: '新增指令' }));
  await screen.findByText('查看路徑');
  expect(await repository.list()).toEqual([{id:'command',name:'查看路徑',command:'pwd'}]);
  await fireEvent.press(screen.getByRole('button', { name: '刪除查看路徑' }));
  await fireEvent.press(screen.getByRole('button', { name: '取消' }));
  expect((await repository.list()).length).toBe(1);
  await fireEvent.press(screen.getByRole('button', { name: '刪除查看路徑' }));
  await fireEvent.press(screen.getByRole('button', { name: '確認刪除' }));
  await waitFor(() => expect(screen.getByText('尚無常用指令')).toBeTruthy());
  expect(await repository.list()).toEqual([]);
});

test('安全儲存暫時失敗可重試，新增失敗保留輸入且不顯示假的成功', async () => {
  const vault = memoryVault(); let locked = true; let failingWrite = true;
  const repository = new CommandRepository({ ...vault,
    get: async key => { if (locked) throw new Error('locked'); return vault.get(key); },
    set: async (key, value) => { if (failingWrite) throw new Error('unavailable'); await vault.set(key,value); },
  }, () => 'retry');
  await render(<CommandProvider repository={repository}><CommandSettings /></CommandProvider>);
  await screen.findByText('無法讀取常用指令，請重試。');
  locked = false;
  await fireEvent.press(screen.getByRole('button',{name:'重試'}));
  await screen.findByText('尚無常用指令');
  await fireEvent.changeText(screen.getByLabelText('指令名稱'),'路徑');
  await fireEvent.changeText(screen.getByLabelText('指令內容'),'pwd');
  await fireEvent.press(screen.getByRole('button',{name:'新增指令'}));
  await screen.findByText('無法新增，請檢查名稱、單行指令與容量後重試。');
  expect(screen.getByLabelText('指令內容').props.value).toBe('pwd');
  expect(await repository.list()).toEqual([]);
  failingWrite = false;
  await fireEvent.press(screen.getByRole('button',{name:'新增指令'}));
  await screen.findByText('路徑');
  expect(screen.getByLabelText('指令內容').props.value).toBe('');
});
