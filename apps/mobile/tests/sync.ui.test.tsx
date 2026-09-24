import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SyncSettings } from '../src/features/sync/SyncSettings';
import { SyncWorkspace } from '../src/features/sync/workspace';
import { HostRepository } from '../src/features/hosts/repository';
const raw=JSON.stringify({version:'termix.mobile-settings.v1',sourceId:'desktop',hosts:[{id:'lab',name:'Lab',address:'lab.example',port:22,username:'admin'}]});
it('使用者選擇檔案模式、檢查筆數後才匯入，並在未登入 iCloud 時保留重試',async()=>{
 const data=new Map<string,string>();
 const storage={getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)}};
 const hosts=new HostRepository(storage,()=> 'phone',{get:async()=>null,set:async()=>{},remove:async()=>{}});
 const workspace=new SyncWorkspace(storage,hosts,async()=>({status:'no_account'}),()=>true);
 await workspace.initialize();
 await render(<SyncSettings workspace={workspace} pickFile={async()=>raw} onBack={()=>{}} />);
 await fireEvent.press(screen.getByText('檔案匯入'));
 await waitFor(()=>expect(screen.getByText('選擇設定檔')).toBeTruthy());
 await fireEvent.press(screen.getByText('選擇設定檔'));
 await waitFor(()=>expect(screen.getByText('1 台主機')).toBeTruthy());
 expect(await hosts.list()).toEqual([]);
 await fireEvent.press(screen.getByText('確認匯入'));
 await waitFor(()=>expect(screen.getByText(/已同步/)).toBeTruthy());
 expect((await hosts.list())[0].authType).toBe('unconfigured');
 await fireEvent.press(screen.getByText('iCloud 同步'));
 await waitFor(()=>expect(screen.getByText(/請先登入與桌面相同的 Apple ID/)).toBeTruthy());
 expect((await hosts.list()).length).toBe(1);
});

for (const capability of ['unsupported', 'not_configured'] as const) {
 it(`${capability} 隱藏 iCloud，保留檔案匯入並停用舊 cloud 模式`, async () => {
  const storage = { getItem: async () => 'cloud', setItem: jest.fn(async () => {}) };
  const hosts = new HostRepository(storage, () => 'phone', { get: async()=>null, set:async()=>{}, remove:async()=>{} });
  const fetch = jest.fn(async () => ({ status: 'ok', payload: raw }));
  const workspace = new SyncWorkspace(storage, hosts, fetch, () => true, capability);
  await workspace.initialize();
  await render(<SyncSettings workspace={workspace} pickFile={async()=>raw} onBack={()=>{}} />);
  expect(screen.queryByText('iCloud 同步')).toBeNull();
  expect(screen.getByText('檔案匯入')).toBeTruthy();
  expect(workspace.getSnapshot().mode).toBe('off');
  await workspace.setMode('cloud'); await workspace.refresh();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
 });
}
