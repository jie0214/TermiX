import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostRepository } from '../src/features/hosts/repository.ts';
import { SyncWorkspace } from '../src/features/sync/workspace.ts';
import { memoryVault } from './fixtures.ts';
const raw=JSON.stringify({version:'termix.mobile-settings.v1',sourceId:'desktop',hosts:[{id:'one',name:'Cloud',address:'cloud.example',port:22,username:'admin'}]});
test('CloudKit 需主動啟用，切換檔案模式後丟棄較晚抵達的雲端結果',async()=>{
 const data=new Map<string,string>();
 const storage={getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)}};
 const hosts=new HostRepository(storage,()=> 'phone',memoryVault());
 let finish!:(value:{status:string;payload:string})=>void;
 let requests=0;
 const workspace=new SyncWorkspace(storage,hosts,async()=>{requests++;return await new Promise(resolve=>{finish=resolve})},()=>true);
 await workspace.initialize();await workspace.refresh();assert.equal(requests,0);
 await workspace.setMode('cloud');const pending=workspace.refresh();
 await workspace.setMode('file');finish({status:'ok',payload:raw});await pending;
 assert.deepEqual(await hosts.list(),[]);assert.equal(workspace.getSnapshot().mode,'file');
});

test('失敗的 CloudKit 回應不修改主機，成功與暫停有不同狀態',async()=>{
 const data=new Map<string,string>();
 const storage={getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)}};
 const hosts=new HostRepository(storage,()=> 'phone',memoryVault());let available=true;let result:{status:string;payload?:string}={status:'network'};
 const workspace=new SyncWorkspace(storage,hosts,async()=>result,()=>available);
 await workspace.initialize();await workspace.setMode('cloud');await workspace.refresh();
 assert.equal(workspace.getSnapshot().lastSuccess,'');assert.ok(workspace.getSnapshot().error);assert.deepEqual(await hosts.list(),[]);
 result={status:'ok',payload:raw};available=false;await workspace.refresh();assert.deepEqual(await hosts.list(),[]);
 available=true;await workspace.refresh();assert.equal((await hosts.list()).length,1);assert.ok(workspace.getSnapshot().lastSuccess);
 result={status:'ok',payload:'invalid'};await workspace.refresh();assert.equal((await hosts.list()).length,1);assert.ok(workspace.getSnapshot().error);
 const restored=new SyncWorkspace(storage,hosts,async()=>result,()=>true);await restored.initialize();assert.equal(restored.getSnapshot().mode,'cloud');
});

test('檔案必須確認才能套用，取消或進入背景不會匯入',async()=>{
 const data=new Map<string,string>();
 const storage={getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{data.set(k,v)}};
 const hosts=new HostRepository(storage,()=> 'phone',memoryVault());
 const workspace=new SyncWorkspace(storage,hosts,async()=>({status:'empty'}),()=>true);
 await workspace.initialize();await workspace.setMode('file');workspace.prepareFile(raw);
 assert.equal(workspace.getSnapshot().preview?.count,1);assert.deepEqual(await hosts.list(),[]);
 workspace.cancelFile();await workspace.applyFile();assert.deepEqual(await hosts.list(),[]);
 workspace.prepareFile(raw);workspace.setActive(false);await workspace.applyFile();assert.deepEqual(await hosts.list(),[]);
 workspace.setActive(true);workspace.prepareFile(raw);await workspace.applyFile();assert.equal((await hosts.list()).length,1);
});

test('同步方式寫入失敗時保留舊模式，不開始雲端同步',async()=>{
 const storage={getItem:async()=>null,setItem:async()=>{throw new Error('disk')}};
 const hosts=new HostRepository(storage,()=> 'phone',memoryVault());let requests=0;
 const workspace=new SyncWorkspace(storage,hosts,async()=>{requests++;return {status:'empty'}},()=>true);
 await workspace.initialize();await workspace.setMode('cloud');await workspace.refresh();
 assert.equal(workspace.getSnapshot().mode,'off');assert.equal(requests,0);assert.ok(workspace.getSnapshot().error);
});

test('切換模式時已提交的主機寫入仍刷新清單，避免資料庫與畫面不同步',async()=>{
 const data=new Map<string,string>();let finish!:()=>void;
 const storage={getItem:async(k:string)=>data.get(k)??null,setItem:async(k:string,v:string)=>{
  if(k==='termix.mobile.hosts.v1') await new Promise<void>(resolve=>{finish=()=>{data.set(k,v);resolve()}});
  else data.set(k,v);
 }};
 const hosts=new HostRepository(storage,()=> 'phone',memoryVault());
 const workspace=new SyncWorkspace(storage,hosts,async()=>({status:'ok',payload:raw}),()=>true);let refreshed=0;
 workspace.setOnApplied(async()=>{refreshed++});await workspace.initialize();await workspace.setMode('cloud');
 const pending=workspace.refresh();while(!finish) await new Promise(done=>setImmediate(done));
 await workspace.setMode('off');finish();await pending;
 assert.equal((await hosts.list()).length,1);assert.equal(refreshed,1);assert.equal(workspace.getSnapshot().mode,'off');
});
