import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TerminalComposer } from '../src/features/terminal/TerminalComposer';
import { TerminalSession } from '../src/features/terminal/session';
import { CommandProvider } from '../src/features/commands/CommandProvider';
import { CommandRepository } from '../src/features/commands/repository';
import { memoryVault } from './fixtures';

test('機密輸入遮蔽、送出失敗仍清空，背景會清除未送出內容', async () => {
  let change!: (state: AppStateStatus) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, fn) => { change = fn; return { remove: jest.fn() }; });
  const session = new TerminalSession({start:async()=>{},poll:async()=>[],trust:async()=>{},write:async()=>{},resize:async()=>{},disconnect:async()=>{}},
    {getCredentials:async()=>null,updatePrivateKeyPassphrase:async()=>{}},{get:async()=>'',save:async()=>{}},()=> 'secret');
  const send = jest.spyOn(session,'send').mockResolvedValue(false);
  const view = await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:0,left:0,right:0,bottom:0}}}>
    <CommandProvider repository={new CommandRepository(memoryVault(),()=> 'test')}><TerminalComposer session={session}/></CommandProvider>
  </SafeAreaProvider>);
  await fireEvent.press(screen.getByLabelText('快捷鍵與常用指令'));
  await fireEvent.press(screen.getByText('啟用機密輸入'));
  expect(screen.getByLabelText('終端輸入').props.secureTextEntry).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('終端輸入'),'test-only-secret');
  await fireEvent.press(screen.getByText('送出'));
  expect(send).toHaveBeenCalledWith('test-only-secret\r');
  expect(screen.getByLabelText('終端輸入').props.value).toBe('');
  await fireEvent.changeText(screen.getByLabelText('終端輸入'),'unsent-secret');
  await act(()=>change('inactive'));
  expect(screen.getByLabelText('終端輸入').props.value).toBe('');
  await view.unmount(); listener.mockRestore();
});
