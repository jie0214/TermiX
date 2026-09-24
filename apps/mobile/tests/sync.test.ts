import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostRepository } from '../src/features/hosts/repository.ts';
import { memoryVault, passwordAuth } from './fixtures.ts';
const host = { id: 'desktop-host', name: 'Lab', address: 'lab.example', port: 22, username: 'admin' };
const document = (hosts: unknown[] = [host]) => JSON.stringify({ version: 'termix.mobile-settings.v1', sourceId: 'desktop-1', hosts });
function setup() {
 const data = new Map<string,string>(); let next=0;
 const storage = {getItem:async (key:string)=>data.get(key)??null,setItem:async (key:string,value:string)=>{data.set(key,value);}};
 const vault=memoryVault();
 return { data, storage, vault, repository:new HostRepository(storage,()=>`phone-${++next}`,vault) };
}
test('同步重複匯入不重複主機，重開保留資料且不影響手機自行新增的主機',async()=>{
 const {repository,storage,vault}=setup();
 await repository.add({name:'Local',address:'local.example',port:'22',username:'me'},passwordAuth);
 await repository.importSettings(document());
 await repository.importSettings(document());
 const restored=new HostRepository(storage,()=> 'unused',vault);
 const hosts=await restored.list();
 assert.equal(hosts.length,2);assert.equal(hosts[0].name,'Local');
 assert.equal(hosts[1].name,'Lab');assert.equal(hosts[1].authType,'unconfigured');
 assert.equal(await restored.getCredentials(hosts[1].id),null);
});

test('本機補上驗證後更名保留憑證，連線目標改變必須重新驗證',async()=>{
 const {repository,data}=setup();
 await repository.importSettings(document());
 const saved=(await repository.list())[0];
 await repository.configureAuthentication(saved,passwordAuth);
 await repository.importSettings(document([{...host,name:'Renamed'}]));
 assert.deepEqual(await repository.getCredentials(saved.id),passwordAuth);
 await repository.importSettings(document([{...host,address:'new.example'}]));
 assert.equal(await repository.getCredentials(saved.id),null);
 assert.equal((await repository.list())[0].authType,'unconfigured');
 await assert.rejects(repository.configureAuthentication(saved,passwordAuth));
 assert.ok(!JSON.stringify([...data.values()]).includes('test-only-password'));
});

test('無效、重複及機密欄位整份拒絕，儲存失敗保留原始主機',async()=>{
 const {repository,storage,vault,data}=setup();
 await repository.importSettings(document());
 const before=await repository.list();
 for(const raw of [document([host,host]),document([{...host,port:0}]),document([{...host,password:'must-not-save'}]),'{broken',JSON.stringify({version:'future',sourceId:'a',hosts:[]})]){
  await assert.rejects(repository.importSettings(raw)); assert.deepEqual(await repository.list(),before);
 }
 const failing=new HostRepository({...storage,setItem:async()=>{throw new Error('disk')}},()=> 'new',vault);
 await assert.rejects(failing.importSettings(document([{...host,name:'Changed'}])));
 assert.deepEqual(await repository.list(),before);
 assert.ok(!JSON.stringify([...data]).includes('must-not-save'));
});

test('舊終端畫面的目標不能取得同步後另一目標的新憑證',async()=>{
 const {repository}=setup();
 await repository.importSettings(document());const original=(await repository.list())[0];
 await repository.configureAuthentication(original,passwordAuth);
 await repository.importSettings(document([{...host,username:'new-user'}]));
 const updated=(await repository.list())[0];
 await repository.configureAuthentication(updated,{type:'password',password:'new-target-secret'});
 assert.equal(await repository.getCredentials(original.id,original),null);
 assert.deepEqual(await repository.getCredentials(updated.id,updated),{type:'password',password:'new-target-secret'});
});

test('讀取 Keychain 途中同步改變目標，不得傳回不同目標憑證',async()=>{
 const {repository,storage,vault}=setup();
 await repository.importSettings(document());const original=(await repository.list())[0];
 await repository.configureAuthentication(original,passwordAuth);
 let resolve!:(value:string|null)=>void;
 const racing=new HostRepository(storage,()=> 'unused',{...vault,get:async()=>await new Promise(done=>{resolve=done})});
 const pending=racing.getCredentials(original.id,original);
 while(!resolve) await new Promise(done=>setImmediate(done));
 await repository.importSettings(document([{...host,address:'changed.example'}]));
 resolve(JSON.stringify({type:'password',password:'other-secret'}));
 assert.equal(await pending,null);
});

test('舊終端密語重試不能修改同步後新目標的私鑰',async()=>{
 const {testPrivateKey}=await import('./fixtures.ts');const {repository}=setup();
 await repository.importSettings(document());const original=(await repository.list())[0];
 await repository.configureAuthentication(original,{type:'privateKey',privateKey:testPrivateKey,passphrase:'old'});
 await repository.importSettings(document([{...host,address:'changed.example'}]));const updated=(await repository.list())[0];
 await repository.configureAuthentication(updated,{type:'privateKey',privateKey:testPrivateKey,passphrase:'new'});
 await assert.rejects(repository.updatePrivateKeyPassphrase(original.id,'wrong-old-retry',original));
 assert.equal((await repository.getCredentials(updated.id))?.type,'privateKey');
 assert.deepEqual(await repository.getCredentials(updated.id),{type:'privateKey',privateKey:testPrivateKey,passphrase:'new'});
});

test('v2 保留資料夾層級，移動資料夾不影響憑證，舊 v1 仍可匯入', async () => {
 const {repository,storage,vault}=setup();
 const v2=(folderPath:unknown)=>JSON.stringify({version:'termix.mobile-settings.v2',sourceId:'desktop-1',hosts:[{...host,folderPath}]});
 await repository.importSettings(v2(['工作','正式環境']));
 const saved=(await repository.list())[0];
 await repository.configureAuthentication(saved,passwordAuth);
 await repository.importSettings(v2(['工作','測試環境']));
 const restored=new HostRepository(storage,()=> 'unused',vault);
 assert.deepEqual((await restored.list())[0].folderPath,['工作','測試環境']);
 assert.deepEqual(await restored.getCredentials(saved.id),passwordAuth);
 for(const path of [null,{},[''],['..'],['a/b'],Array(17).fill('a'),['a'.repeat(81)]]) await assert.rejects(repository.importSettings(v2(path)));
 await repository.importSettings(document());
 assert.equal((await repository.list())[0].folderPath,undefined);
 assert.deepEqual(await repository.getCredentials(saved.id),passwordAuth);
});

test('同步版本必須是字串，v2 仍拒絕夾帶機密欄位', async () => {
 const {repository}=setup();
 for(const data of [
  {version:['termix.mobile-settings.v1'],sourceId:'desktop-1',hosts:[host]},
  {version:'termix.mobile-settings.v2',sourceId:'desktop-1',hosts:[{...host,folderPath:[],password:'must-not-save'}]},
 ]) await assert.rejects(repository.importSettings(JSON.stringify(data)));
 assert.deepEqual(await repository.list(),[]);
});
