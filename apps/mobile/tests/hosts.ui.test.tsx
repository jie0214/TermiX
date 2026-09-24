import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { HostRepository } from '../src/features/hosts/repository';
import { HostProvider } from '../src/features/hosts/HostProvider';
import { HostForm } from '../src/features/hosts/HostForm';
import { HostList } from '../src/features/hosts/HostList';
import { memoryVault, testPrivateKey } from './fixtures';
import * as DocumentPicker from 'expo-document-picker';

jest.mock('expo', () => ({ requireNativeModule: () => ({ clearSensitiveImportCopy: async () => {} }) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string; size = 500; exists = true;
    constructor(uri: string) { this.uri = uri; }
    async text() { return require('./fixtures').testPrivateKey; }
    delete() { this.exists = false; }
  },
}));

it('使用者儲存主機後可在清單辨認名稱與連線位址', async () => {
  let data: string | null = null;
  const repository = new HostRepository({
    getItem: async () => data,
    setItem: async (_, value) => { data = value; },
  }, () => 'home', memoryVault());
  const onSaved = jest.fn();
  await render(<HostProvider repository={repository}>
    <HostForm onSaved={onSaved} onCancel={() => {}} />
    <HostList onAdd={() => {}} />
  </HostProvider>);
  await fireEvent.changeText(screen.getByLabelText('名稱'), 'Home lab');
  await fireEvent.changeText(screen.getByLabelText('主機位址'), '192.0.2.10');
  await fireEvent.changeText(screen.getByLabelText('使用者名稱'), 'admin');
  await fireEvent.changeText(screen.getByLabelText('登入密碼'), 'test-only-password');
  await fireEvent.press(screen.getByRole('button', { name: '儲存' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Home lab')).toBeTruthy();
  expect(screen.getByText('admin@192.0.2.10')).toBeTruthy();
});

it('儲存失敗會保留表單，重試成功才離開', async () => {
  let fail = true;
  let data: string | null = null;
  const repository = new HostRepository({
    getItem: async () => data,
    setItem: async (_, value) => { if (fail) throw new Error('disk'); data = value; },
  }, () => 'home', memoryVault());
  const onSaved = jest.fn();
  await render(<HostProvider repository={repository}><HostForm onSaved={onSaved} onCancel={() => {}} /></HostProvider>);
  await fireEvent.changeText(screen.getByLabelText('名稱'), 'Home lab');
  await fireEvent.changeText(screen.getByLabelText('主機位址'), '192.0.2.10');
  await fireEvent.changeText(screen.getByLabelText('使用者名稱'), 'admin');
  await fireEvent.changeText(screen.getByLabelText('登入密碼'), 'test-only-password');
  await fireEvent.press(screen.getByRole('button', { name: '儲存' }));
  expect(await screen.findByText('儲存失敗，內容已保留，請重試。')).toBeTruthy();
  expect(screen.getByLabelText('主機位址').props.value).toBe('192.0.2.10');
  expect(onSaved).not.toHaveBeenCalled();
  fail = false;
  await fireEvent.press(screen.getByRole('button', { name: '儲存' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

it('讀取失敗不呈現空清單或允許覆蓋，重試後恢復', async () => {
  let fail = true;
  const repository = new HostRepository({
    getItem: async () => { if (fail) throw new Error('disk'); return null; },
    setItem: async () => {},
  }, () => 'home', memoryVault());
  const onAdd = jest.fn();
  await render(<HostProvider repository={repository}><HostList onAdd={onAdd} /></HostProvider>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('尚無主機')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '新增主機' }));
  expect(onAdd).not.toHaveBeenCalled();
  fail = false;
  await fireEvent.press(screen.getByRole('button', { name: '重試' }));
  expect(await screen.findByText('尚無主機')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '新增主機' }));
  expect(onAdd).toHaveBeenCalledTimes(1);
});

it('新增主機可選密碼或 SSH 私鑰驗證', async () => {
  const repository = new HostRepository({ getItem: async () => null, setItem: async () => {} }, () => 'host-auth', memoryVault());
  await render(<HostProvider repository={repository}><HostForm onSaved={() => {}} onCancel={() => {}} /></HostProvider>);
  expect(screen.getByRole('radio', { name: '密碼' })).toBeTruthy();
  expect(screen.getByLabelText('登入密碼')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'SSH 私鑰' }));
  expect(screen.queryByLabelText('登入密碼')).toBeNull();
  expect(screen.getByRole('button', { name: '匯入私鑰檔案' })).toBeTruthy();
  expect(screen.getByLabelText('私鑰密語（選填）')).toBeTruthy();
});

it('匯入私鑰期間禁止儲存，完成後可安全保存私鑰與密語', async () => {
  let complete!: (value: DocumentPicker.DocumentPickerResult) => void;
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let data: string | null = null;
  const vault = memoryVault();
  const repository = new HostRepository({ getItem: async () => data, setItem: async (_, value) => { data = value; } }, () => 'imported-key', vault);
  const onSaved = jest.fn();
  await render(<HostProvider repository={repository}><HostForm onSaved={onSaved} onCancel={() => {}} /></HostProvider>);
  await fireEvent.changeText(screen.getByLabelText('名稱'), '私鑰主機');
  await fireEvent.changeText(screen.getByLabelText('主機位址'), '192.0.2.10');
  await fireEvent.changeText(screen.getByLabelText('使用者名稱'), 'admin');
  await fireEvent.press(screen.getByRole('radio', { name: 'SSH 私鑰' }));
  await fireEvent.press(screen.getByRole('button', { name: '匯入私鑰檔案' }));
  expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
  complete({ canceled: false, assets: [{ uri: 'file:///cache/id', name: 'id_ed25519', lastModified: 0, size: 500 }] });
  expect(await screen.findByText('私鑰已匯入')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('私鑰密語（選填）'), 'test-only-passphrase');
  await fireEvent.press(screen.getByRole('button', { name: '儲存' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(await repository.getCredentials('imported-key')).toEqual({ type: 'privateKey', privateKey: testPrivateKey, passphrase: 'test-only-passphrase' });
});

it('同步主機只需補上本機驗證，保存後可讀取憑證', async () => {
  const data = new Map<string,string>();
  const repository = new HostRepository({getItem:async key=>data.get(key)??null,setItem:async(key,value)=>{data.set(key,value)}},()=> 'synced',memoryVault());
  await repository.importSettings(JSON.stringify({version:'termix.mobile-settings.v1',sourceId:'desktop',hosts:[{id:'lab',name:'Lab',address:'lab.example',port:22,username:'admin'}]}));
  const existing = (await repository.list())[0];
  const onSaved = jest.fn();
  await render(<HostProvider repository={repository}><HostForm existing={existing} onSaved={onSaved} onCancel={()=>{}} /></HostProvider>);
  await waitFor(()=>expect(screen.getByText('admin@lab.example:22')).toBeTruthy());
  expect(screen.queryByLabelText('主機位址')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('登入密碼'),'phone-only-test-password');
  await fireEvent.press(screen.getByRole('button',{name:'儲存'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(1));
  expect(await repository.getCredentials(existing.id)).toEqual({type:'password',password:'phone-only-test-password'});
  expect([...data.values()].join('')).not.toContain('phone-only-test-password');
});

it('資料夾逐層導覽、跨層搜尋與清除搜尋保留位置，新增沿用目前資料夾', async () => {
  let data: string | null = null; let next=0;
  const repository=new HostRepository({getItem:async()=>data,setItem:async(_,value)=>{data=value;}},()=>`h${++next}`,memoryVault());
  for (const [name,folderPath] of [['Root',[]],['Production',['工作','正式環境']],['Development',['工作','測試環境']]] as const) {
    await repository.add({name,address:`${name.toLowerCase()}.example`,username:'admin',port:'22',folderPath:[...folderPath]}, {type:'password',password:'test-only-password'});
  }
  const onAdd=jest.fn(); const onConnect=jest.fn();
  await render(<HostProvider repository={repository}><HostList onAdd={onAdd} onConnect={onConnect}/></HostProvider>);
  await fireEvent.press(await screen.findByRole('button',{name:'開啟資料夾 工作'}));
  expect(screen.queryByText('Root')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'開啟資料夾 正式環境'}));
  await fireEvent.press(screen.getByRole('button',{name:'新增主機'}));
  expect(onAdd).toHaveBeenCalledWith(['工作','正式環境']);
  await fireEvent.changeText(screen.getByLabelText('搜尋主機'),'DEVELOPMENT.example');
  expect(screen.getByText('Development')).toBeTruthy();
  expect(screen.queryByText('Production')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'Development，admin@development.example，連接埠 22'}));
  expect(onConnect.mock.calls[0][0].name).toBe('Development');
  await fireEvent.changeText(screen.getByLabelText('搜尋主機'),'unmatched');
  expect(screen.getByText('找不到主機')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'清除搜尋'}));
  expect(screen.getByText('Production')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'上一層'}));
  expect(screen.getByRole('button',{name:'開啟資料夾 測試環境'})).toBeTruthy();
});

it('新增主機可儲存巢狀資料夾並在重開後保留', async () => {
  let data: string | null = null;
  const repository=new HostRepository({getItem:async()=>data,setItem:async(_,value)=>{data=value;}},()=> 'folder-host',memoryVault());
  const onSaved=jest.fn();
  await render(<HostProvider repository={repository}><HostForm initialFolder={['工作']} onSaved={onSaved} onCancel={()=>{}}/></HostProvider>);
  expect(screen.getByLabelText('資料夾（選填）').props.value).toBe('工作');
  await fireEvent.changeText(screen.getByLabelText('名稱'),'Lab');
  await fireEvent.changeText(screen.getByLabelText('主機位址'),'lab.example');
  await fireEvent.changeText(screen.getByLabelText('使用者名稱'),'admin');
  await fireEvent.changeText(screen.getByLabelText('資料夾（選填）'),' 工作 / 正式環境 ');
  await fireEvent.changeText(screen.getByLabelText('登入密碼'),'test-only-password');
  await fireEvent.press(screen.getByRole('button',{name:'儲存'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalled());
  expect((await repository.list())[0].folderPath).toEqual(['工作','正式環境']);
});
