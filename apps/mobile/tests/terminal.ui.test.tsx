import { ThemeContext, lightColors, darkColors } from '../src/components/theme';
import { AppearanceProvider } from '../src/features/appearance/AppearanceProvider';
import { AppearanceSettings } from '../src/features/appearance/AppearanceSettings';
import { AppearanceStore } from '../src/features/appearance/store';
import { CommandProvider } from '../src/features/commands/CommandProvider';
import { CommandRepository } from '../src/features/commands/repository';
import { HostRepository } from '../src/features/hosts/repository';
import { memoryVault, testPrivateKey } from './fixtures';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TerminalSession } from '../src/features/terminal/session';
import { TerminalProvider } from '../src/features/terminal/TerminalProvider';
import { TerminalScreen } from '../src/features/terminal/TerminalScreen';
import type { SSHEvent, SSHTransport } from '../src/features/terminal/contracts';

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: React.forwardRef((props: object, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() }));
    return <View {...props} />;
  }) };
});

test('確認指紋後送出命令，切換外觀保留連線與輸入，再手動中斷', async () => {
  const events: SSHEvent[] = []; const writes: string[] = [];
  let starts = 0; let disconnects = 0;
  const appearance = new AppearanceStore({ getItem: async () => null, setItem: async () => {} });
  const transport: SSHTransport = {
    start: async () => {starts++; events.push({type:'hostKey',key:'test',fingerprint:'SHA256:test-fingerprint',algorithm:'ssh-ed25519'});},
    poll: async () => events.splice(0),trust: async () => {events.push({type:'connected'});},
    write: async (_,text) => {writes.push(text);},resize: async () => {},disconnect: async () => { disconnects++; },
  };
  const session = new TerminalSession(transport,{updatePrivateKeyPassphrase:async()=>{},getCredentials:async()=>({type:'password',password:'test-only'})},{get:async()=>'',save:async()=>{}},()=> 'ui');
  await render(<AppearanceProvider store={appearance}><AppearanceSettings onBack={() => {}} /><SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><CommandProvider repository={new CommandRepository(memoryVault(), () => "cmd")}><TerminalProvider session={session}><TerminalScreen /></TerminalProvider></CommandProvider></SafeAreaProvider></AppearanceProvider>);
  await act(() => session.connect({id:'h',name:'Home lab',address:'example.com',port:22,username:'test',authType:'password'}));
  expect(await screen.findByText('SHA256:test-fingerprint')).toBeTruthy();
  expect(screen.getByText('test@example.com:22')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'信任並連線'}));
  await screen.findByText('已連線');
  await fireEvent.changeText(screen.getByLabelText('終端輸入'),'pwd');
  await fireEvent.press(screen.getByRole('radio', { name: '深色' }));
  await waitFor(() => expect(screen.getByLabelText('終端輸入')).toHaveStyle({ color: '#f2f2f7' }));
  expect(screen.getByDisplayValue('pwd')).toBeTruthy();
  expect(screen.getByText('已連線')).toBeTruthy();
  expect(starts).toBe(1); expect(disconnects).toBe(0);
  await fireEvent.press(screen.getByRole('button',{name:'送出'}));
  await waitFor(()=>expect(writes).toEqual(['pwd\r']));
  await fireEvent.press(screen.getByRole('button',{name:'中斷'}));
  await screen.findByText('已中斷連線。');
  expect(screen.queryByLabelText('終端輸入')).toBeNull();
});

test('私鑰解密失敗可修正密語，安全保存後重新登入且不顯示機密',async()=>{
  const data=new Map<string,string>();
  const repository=new HostRepository({getItem:async key=>data.get(key)??null,setItem:async(key,value)=>{data.set(key,value);}},()=> 'key-host',memoryVault());
  const host=await repository.add({name:'私鑰主機',address:'example.com',username:'test',port:'22'},{type:'privateKey',privateKey:testPrivateKey,passphrase:'wrong-secret'});
  const events:SSHEvent[]=[];
  const transport:SSHTransport={
    start:async config=>{events.push(config.credentials.type==='privateKey'&&config.credentials.passphrase==='correct-secret'?{type:'connected'}:{type:'error',code:'private_key_decryption_failed'});},
    poll:async()=>events.splice(0),trust:async()=>{},write:async()=>{},resize:async()=>{},disconnect:async()=>{},
  };
  let serial=0;
  const session=new TerminalSession(transport,repository,{get:async()=>'',save:async()=>{}},()=>String(++serial));
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><CommandProvider repository={new CommandRepository(memoryVault(), () => "cmd")}><TerminalProvider session={session}><TerminalScreen /></TerminalProvider></CommandProvider></SafeAreaProvider>);
  await act(()=>session.connect(host));
  await screen.findByText('私鑰解密失敗，請確認密語與檔案。');
  const field=screen.getByLabelText('私鑰密語');expect(field.props.secureTextEntry).toBe(true);
  await fireEvent.changeText(field,'correct-secret');
  await fireEvent.press(screen.getByRole('button',{name:'儲存密語並重試'}));
  await screen.findByText('已連線');
  expect(await repository.getCredentials(host.id)).toEqual({type:'privateKey',privateKey:testPrivateKey,passphrase:'correct-secret'});
  expect(JSON.stringify([...data.values()])).not.toContain('correct-secret');
  expect(screen.queryByLabelText('私鑰密語')).toBeNull();
  expect(JSON.stringify(session.getSnapshot())).not.toContain('correct-secret');
  await act(()=>session.disconnect());
});


test('快捷面板能關閉重開，控制鍵送至 SSH，常用指令須手動送出', async () => {
  const repository = new CommandRepository(memoryVault(), () => 'saved');
  await repository.add('目前路徑', 'pwd');
  const writes: string[] = []; const events: SSHEvent[] = [];
  const session = new TerminalSession({
    start: async () => { events.push({type:'connected'}); }, poll: async () => events.splice(0),
    trust: async () => {}, write: async (_, data) => {writes.push(data);}, resize: async () => {}, disconnect: async () => {},
  }, {getCredentials: async () => ({type:'password',password:'test'}),updatePrivateKeyPassphrase:async()=>{}}, {get:async()=>'',save:async()=>{}}, () => 'shortcuts');
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><CommandProvider repository={repository}><TerminalProvider session={session}><TerminalScreen /></TerminalProvider></CommandProvider></SafeAreaProvider>);
  await act(() => session.connect({id:'h',name:'主機',address:'example.com',port:22,username:'test',authType:'password'}));
  await screen.findByText('已連線');
  await fireEvent.changeText(screen.getByLabelText('終端輸入'), 'pw');
  await fireEvent.press(screen.getByRole('button', {name:'快捷鍵與常用指令'}));
  await fireEvent.press(screen.getByRole('button', {name:'Tab'}));
  await waitFor(() => expect(writes).toEqual(['pw\t']));
  await fireEvent.press(screen.getByRole('button', {name:'Ctrl+C'}));
  await waitFor(() => expect(writes).toEqual(['pw\t','\u0003']));
  await fireEvent.press(screen.getByRole('button', {name:'上'}));
  await waitFor(() => expect(writes).toEqual(['pw\t','\u0003','\u001b[A']));
  await fireEvent.press(screen.getByRole('button', {name:'關閉快捷面板'}));
  await fireEvent.press(screen.getByRole('button', {name:'快捷鍵與常用指令'}));
  await fireEvent.press(screen.getByRole('button', {name:'目前路徑'}));
  await screen.findByText('先傳送 Ctrl+C，再填入指令？');
  expect(writes).toHaveLength(3);
  await fireEvent.press(screen.getByRole('button', {name:'傳送 Ctrl+C 並填入'}));
  expect(screen.getByLabelText('終端輸入').props.value).toBe('pwd');
  expect(writes[3]).toBe('\u0003');
  await fireEvent.press(screen.getByRole('button', {name:'送出'}));
  await waitFor(() => expect(writes[4]).toBe('pwd\r'));
  await fireEvent.changeText(screen.getByLabelText('終端輸入'), 'existing');
  await fireEvent.press(screen.getByRole('button', {name:'快捷鍵與常用指令'}));
  await fireEvent.press(screen.getByRole('button', {name:'目前路徑'}));
  await screen.findByText('取代目前輸入？');
  await fireEvent.press(screen.getByRole('button', {name:'取消取代'}));
  await fireEvent.press(screen.getByRole('button', {name:'關閉快捷面板'}));
  expect(screen.getByLabelText('終端輸入').props.value).toBe('existing');
  await fireEvent.press(screen.getByRole('button', {name:'快捷鍵與常用指令'}));
  await fireEvent.press(screen.getByRole('button', {name:'目前路徑'}));
  await fireEvent.press(screen.getByRole('button', {name:'取代輸入'}));
  expect(screen.getByLabelText('終端輸入').props.value).toBe('pwd');
  expect(writes).toHaveLength(5);
  await fireEvent.press(screen.getByRole('button', {name:'快捷鍵與常用指令'}));
  await act(() => session.disconnect());
  expect(screen.queryByRole('button', {name:'Tab'})).toBeNull();
  expect(screen.queryByRole('button', {name:'快捷鍵與常用指令'})).toBeNull();
});

test('尚未連線的終端背景隨淺色與深色切換', async () => {
  const session = new TerminalSession({ start: async () => {}, poll: async () => [], trust: async () => {}, write: async () => {}, resize: async () => {}, disconnect: async () => {} },
    { updatePrivateKeyPassphrase: async () => {}, getCredentials: async () => null }, { get: async () => '', save: async () => {} }, () => 'unused');
  const content = (dark: boolean) => <ThemeContext.Provider value={{ dark, colors: dark ? darkColors : lightColors }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 59, left: 0, right: 0, bottom: 34 } }}>
      <TerminalProvider session={session}><TerminalScreen /></TerminalProvider>
    </SafeAreaProvider>
  </ThemeContext.Provider>;
  const view = await render(content(true));
  expect(screen.getByText('從主機清單選擇連線目標').parent).toHaveStyle({ backgroundColor: darkColors.background });
  await view.rerender(content(false));
  expect(screen.getByText('從主機清單選擇連線目標').parent).toHaveStyle({ backgroundColor: lightColors.background });
});
