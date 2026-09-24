import test from 'node:test';
import assert from 'node:assert/strict';
import { KubernetesWorkspace } from '../src/features/kubernetes/workspace.ts';

const unusedResources = {
  listPodMetrics:async()=>({}),
  listNamespaces: async () => ({items:["dev","staging","default"],cursor:""}),
  listAWSProfiles: async () => [],
  selectAWSProfile: async (raw:string) => raw,
  selectContext: async (raw: string) => raw,
  getPodMetrics: async () => { throw new Error('非預期用量查詢'); },
  getScale: async () => { throw new Error('非預期縮放查詢'); },
  updateScale: async () => { throw new Error('非預期縮放寫入'); },
  getPodContainers: async () => { throw new Error('非預期容器查詢'); },
  getPodLogs: async () => { throw new Error('非預期 Log 查詢'); },
  listResources: async () => { throw new Error('非預期資源查詢'); },
  getConfigMap: async () => { throw new Error('非預期明細查詢'); },
};
const profile = { context: 'lab', cluster: 'demo', namespace: 'dev' };
const raw = 'apiVersion: v1\nkind: Config\nusers: [secret-token]';
test('匯入成功後重開可查看目前 namespace 的 Pod，狀態不包含 token', async () => {
  let stored: string | null = null;
  const storage = { load: async () => stored, save: async (value: string) => { stored = value; } };
  const calls: string[] = [];
  const client = { ...unusedResources, inspect: async () => profile,
    listPods: async (config: string, namespace: string) => { calls.push(namespace); assert.equal(config, raw); return { items: [{ name: 'api-0', namespace, phase: 'Running', ready: 1, total: 1 }], hasMore: false }; } };
  const first = new KubernetesWorkspace(client, storage);
  await first.import(raw);
  assert.equal(JSON.stringify(first.getSnapshot()).includes('secret-token'), false);
  const reopened = new KubernetesWorkspace(client, storage);
  await reopened.load();
  await reopened.refresh();
  assert.deepEqual(reopened.getSnapshot().pods, [{ name: 'api-0', namespace: 'dev', phase: 'Running', ready: 1, total: 1 }]);
  assert.deepEqual(calls, ['dev']);
});

test('匯入與連線失敗不顯示假成功，也不覆蓋既有 profile', async () => {
  let stored = raw;
  const storage = { load: async () => stored, save: async (_: string) => { throw new Error('vault write failed'); } };
  const client = { ...unusedResources, inspect: async (config: string) => { if (config === 'invalid') throw new Error('config_invalid'); return profile; },
    listPods: async () => { throw new Error('forbidden'); } };
  const workspace = new KubernetesWorkspace(client, storage);
  await workspace.load();
  await workspace.import('invalid');
  assert.equal(workspace.getSnapshot().profile?.context, 'lab');
  await workspace.import('new config');
  assert.equal(stored, raw);
  assert.equal(workspace.getSnapshot().profile?.context, 'lab');
  await workspace.refresh();
  assert.equal(workspace.getSnapshot().status, 'error');
  assert.deepEqual(workspace.getSnapshot().pods, []);
});

test('查詢期間切換 namespace 不顯示舊 Pod', async () => {
  let finish: ((value: { items: { name: string; namespace: string; phase: string; ready: number; total: number }[]; hasMore: boolean }) => void) | undefined;
  const workspace = new KubernetesWorkspace({ ...unusedResources, inspect:async()=>profile,
    listPods:async()=>new Promise(resolve => { finish = resolve; }) },
    {load:async()=>raw,save:async()=>{}});
  await workspace.load();
  const pending = workspace.refresh();
  await Promise.resolve();
  workspace.setNamespace('staging');
  finish?.({items:[{name:'old',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false});
  await pending;
  assert.deepEqual(workspace.getSnapshot().pods, []);
  assert.equal(workspace.getSnapshot().namespace, 'staging');
});

test('匯入儲存期間不可切換 namespace 造成畫面與叢集不一致', async () => {
  let finish: (() => void) | undefined;
  let stored = raw;
  const workspace = new KubernetesWorkspace({ ...unusedResources, inspect: async config => config === raw ? profile : {context:'new',cluster:'other',namespace:'prod'},
    listPods: async config => ({items:[{name: config === raw ? 'old' : 'new',namespace:'prod',phase:'Running',ready:1,total:1}],hasMore:false}) },
    {load:async()=>stored,save:async value=>{await new Promise<void>(resolve=>{finish=resolve;});stored=value;}});
  await workspace.load();
  const pending = workspace.import('new-config');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(finish);
  workspace.setNamespace('staging');
  finish?.();
  await pending;
  assert.equal(workspace.getSnapshot().profile?.cluster,'other');
  assert.equal(workspace.getSnapshot().namespace,'prod');
  await workspace.refresh();
  assert.equal(workspace.getSnapshot().pods[0].name,'new');
});

test('憑證錯誤保留舊設定且僅顯示安全提示', async () => {
  const expected = {
    certificate_incomplete: '請同時提供內嵌用戶端憑證與私鑰。',
    certificate_invalid: '憑證或私鑰格式無效、不匹配，或私鑰已加密。',
    certificate_expired: '用戶端憑證已過期，請更新後重新匯入。',
    certificate_not_yet_valid: '用戶端憑證尚未生效，請確認憑證日期與手機時間。',
    ambiguous_auth: '請只保留 token 或用戶端憑證其中一種驗證方式。',
  };
  for (const [code, text] of Object.entries(expected)) {
    let stored = raw;
    const workspace = new KubernetesWorkspace({ ...unusedResources,
      inspect: async value => { if (value !== raw) throw new Error('Native: ' + code + ' private-key-secret'); return profile; },
      listPods: async () => ({ items: [], hasMore: false }),
    }, { load: async () => stored, save: async value => { stored = value; } });
    await workspace.load();
    assert.equal(await workspace.import('new-private-key'), false);
    assert.equal(stored, raw);
    assert.deepEqual(workspace.getSnapshot().profile, profile);
    assert.equal(workspace.getSnapshot().message, text);
    assert.equal(JSON.stringify(workspace.getSnapshot()).includes('private-key'), false);
  }
});

test('切換分類或 namespace 後，延遲清單與 ConfigMap 內容不能重新出現', async () => {
  let finishList: ((value: import('../src/features/kubernetes/workspace.ts').ResourceList) => void) | undefined;
  let finishDetail: ((value: import('../src/features/kubernetes/workspace.ts').ConfigMapDetail) => void) | undefined;
  const item = {name:'settings',namespace:'dev',ready:0,desired:0,updated:0,keyCount:1,immutable:false};
  const detail = {name:'settings',namespace:'dev',immutable:false,entries:[{key:'key',value:'sensitive-preview',binary:false,bytes:17,truncated:false}],truncated:false};
  const workspace = new KubernetesWorkspace({ ...unusedResources, inspect:async()=>profile,listPods:async()=>({items:[],hasMore:false}),
    listResources:async()=>new Promise(resolve=>{finishList=resolve;}),
    getConfigMap:async()=>new Promise(resolve=>{finishDetail=resolve;})},
  {load:async()=>raw,save:async()=>{throw new Error('查詢不可寫入儲存');}});
  await workspace.load();
  workspace.setKind('deployments');
  const oldList=workspace.refresh();await Promise.resolve();
  workspace.setKind('configmaps');
  finishList?.({items:[item],hasMore:false});await oldList;
  assert.deepEqual(workspace.getSnapshot().resources,[]);
  const newList=workspace.refresh();await Promise.resolve();
  finishList?.({items:[item],hasMore:false});await newList;
  for (const action of ['close','namespace']) {
    const pending=workspace.openConfigMap('settings');await Promise.resolve();
    if(action==='close') workspace.closeDetail(); else workspace.setNamespace('staging');
    finishDetail?.(detail);await pending;
    assert.equal(workspace.getSnapshot().detail,undefined);
    assert.equal(JSON.stringify(workspace.getSnapshot()).includes('sensitive-preview'),false);
  }
});

test('ConfigMap 明細失敗可重試，內容關閉即清除，不寫入儲存', async () => {
  let fail=true;
  const workspace = new KubernetesWorkspace({ ...unusedResources, inspect:async()=>profile,listPods:async()=>({items:[],hasMore:false}),
    listResources:async()=>({items:[{name:'settings',namespace:'dev',ready:0,desired:0,updated:0,keyCount:0,immutable:false}],hasMore:false}),
    getConfigMap:async()=>{if(fail)throw new Error('forbidden secret-server-body');return {name:'settings',namespace:'dev',immutable:false,entries:[],truncated:false};}},
  {load:async()=>raw,save:async()=>{throw new Error('唯讀操作');}});
  await workspace.load();workspace.setKind('configmaps');await workspace.refresh();
  await workspace.openConfigMap('settings');
  assert.equal(workspace.getSnapshot().detailStatus,'error');
  assert.equal(workspace.getSnapshot().detailMessage,'此帳號沒有查看此資源的權限。');
  fail=false;await workspace.openConfigMap('settings');
  assert.equal(workspace.getSnapshot().detailStatus,'ready');
  workspace.closeDetail();assert.equal(workspace.getSnapshot().detail,undefined);
});

test('Log 切換容器及關閉面板後，舊回應不可復活或寫入儲存', async () => {
  const pending: ((value: {text:string;truncated:boolean})=>void)[]=[];
  const workspace = new KubernetesWorkspace({ ...unusedResources, inspect:async()=>profile,
    listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:2}],hasMore:false}),
    getPodContainers:async()=>({containers:[{name:'app',kind:'regular'},{name:'sidecar',kind:'regular'}]}),
    getPodLogs:async()=>new Promise(resolve=>{pending.push(resolve);}),
  },{load:async()=>raw,save:async()=>{throw new Error('Log 不可寫入磁碟');}});
  await workspace.load();await workspace.refresh();
  const first=workspace.openPodLogs('web');
  for(let i=0;i<5;i++) await Promise.resolve();
  assert.equal(pending.length,1);
  const second=workspace.selectLogContainer('sidecar');
  for(let i=0;i<5;i++) await Promise.resolve();
  assert.equal(pending.length,2);
  pending[0]({text:'old-sensitive-log',truncated:false});await first;
  assert.equal(workspace.getSnapshot().logs?.text,'');
  pending[1]({text:'sidecar-log',truncated:false});await second;
  assert.equal(workspace.getSnapshot().logs?.text,'sidecar-log');
  const refresh=workspace.refreshLogs();await Promise.resolve();
  workspace.closeLogs();pending[2]({text:'late-sensitive-log',truncated:false});await refresh;
  assert.equal(workspace.getSnapshot().logs,undefined);
  assert.equal(JSON.stringify(workspace.getSnapshot()).includes('sensitive-log'),false);
});

test('容器查詢途中切換 namespace 不建立 Log 面板，Log 錯誤清除舊內容且可重試', async () => {
  let finish: ((value: import('../src/features/kubernetes/workspace.ts').PodContainers)=>void)|undefined;
  let fail=false;let delay=true;
  const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,
    listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
    getPodContainers:async()=>delay?new Promise(resolve=>{finish=resolve;}):{containers:[{name:'app',kind:'regular'}]},
    getPodLogs:async()=>{if(fail)throw new Error('logs_unavailable secret-error');return {text:'actual-log',truncated:false};},
  },{load:async()=>raw,save:async()=>{}});
  await workspace.load();await workspace.refresh();
  const opening=workspace.openPodLogs('web');await Promise.resolve();
  workspace.setNamespace('other');
  finish?.({containers:[{name:'app',kind:'regular'}]});await opening;
  assert.equal(workspace.getSnapshot().logs,undefined);
  workspace.setNamespace('dev');await workspace.refresh();delay=false;await workspace.openPodLogs('web');
  fail=true;await workspace.setPreviousLogs(true);
  assert.equal(workspace.getSnapshot().logs?.text,'');
  assert.equal(workspace.getSnapshot().logs?.message,'此容器目前無法提供 Log，可能尚未啟動或沒有前次紀錄。');
  fail=false;await workspace.refreshLogs();
  assert.equal(workspace.getSnapshot().logs?.text,'actual-log');
});

test('縮放必須確認後才寫入，零副本成功不宣稱已就緒', async () => {
 const writes: unknown[]=[];
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>({items:[{name:'web',namespace:'dev',ready:3,desired:3,updated:3,keyCount:0,immutable:false}],hasMore:false}),
  getScale:async()=>({uid:'id',resourceVersion:'7',replicas:3}),
  updateScale:async(...args)=>{writes.push(args);return {uid:'id',resourceVersion:'8',replicas:0};},
 },{load:async()=>raw,save:async()=>{throw new Error('不可寫入儲存');}});
 await workspace.load();workspace.setKind('deployments');await workspace.refresh();await workspace.openScale('web');
 workspace.setScaleReplicas('0');await workspace.submitScale();assert.equal(writes.length,0);
 workspace.reviewScale();assert.equal(workspace.getSnapshot().scale?.status,'confirming');
 await workspace.submitScale();assert.equal(writes.length,1);
 assert.equal(workspace.getSnapshot().scale?.status,'success');
 assert.match(workspace.getSnapshot().scale!.message,/不代表已就緒/);
 await workspace.submitScale();assert.equal(writes.length,1);
});

test('縮放衝突與結果不明必須重新讀取並再次確認，不自動重送', async () => {
 for(const code of ['scale_conflict','scale_unknown','forbidden']) {
  let writes=0;let reads=0;
  const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,listPods:async()=>({items:[],hasMore:false}),
   listResources:async()=>({items:[{name:'web',namespace:'dev',ready:1,desired:1,updated:1,keyCount:0,immutable:false}],hasMore:false}),
   getScale:async()=>({uid:'id',resourceVersion:String(++reads),replicas:1}),
   updateScale:async()=>{writes++;throw new Error(code);},
  },{load:async()=>raw,save:async()=>{}});
  await workspace.load();workspace.setKind('statefulsets');await workspace.refresh();await workspace.openScale('web');
  workspace.setScaleReplicas('2');workspace.reviewScale();await workspace.submitScale();
  assert.equal(workspace.getSnapshot().scale?.status,'error');assert.deepEqual(workspace.getSnapshot().resources,[]);
  await workspace.submitScale();assert.equal(writes,1);
  await workspace.openScale('web');assert.equal(reads,2);assert.equal(workspace.getSnapshot().scale?.status,'editing');
  await workspace.submitScale();assert.equal(writes,1);
 }
});

test('送出途中關閉不重送，不切換叢集；完成後保留結果提示且面板不復活', async () => {
 let finish: ((value:{uid:string;resourceVersion:string;replicas:number})=>void)|undefined;
 let writes=0;
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>({items:[{name:'web',namespace:'dev',ready:1,desired:1,updated:1,keyCount:0,immutable:false}],hasMore:false}),
  getScale:async()=>({uid:'id',resourceVersion:'1',replicas:1}),
  updateScale:async()=>{writes++;return new Promise(resolve=>{finish=resolve;});},
 },{load:async()=>raw,save:async()=>{throw new Error('不可匯入');}});
 await workspace.load();workspace.setKind('deployments');await workspace.refresh();await workspace.openScale('web');
 workspace.setScaleReplicas('2');workspace.reviewScale();const pending=workspace.submitScale();await Promise.resolve();
 await workspace.submitScale();workspace.closeScale();workspace.setNamespace('prod');workspace.setKind('pods');
 assert.equal(await workspace.import('other'),false);await workspace.refresh();
 assert.equal(workspace.getSnapshot().namespace,'dev');assert.equal(workspace.getSnapshot().kind,'deployments');assert.equal(writes,1);
 finish?.({uid:'id',resourceVersion:'2',replicas:2});await pending;
 assert.equal(workspace.getSnapshot().scale,undefined);assert.match(workspace.getSnapshot().scaleNotice!,/已接受/);
 workspace.setNamespace('prod');assert.equal(workspace.getSnapshot().scaleNotice,undefined);
});

test('取消待確認或尚未送出的縮放，不得背景送出', async () => {
 let hold=false;let release:((value:string)=>void)|undefined;let writes=0;
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>({items:[{name:'web',namespace:'dev',ready:1,desired:1,updated:1,keyCount:0,immutable:false}],hasMore:false}),
  getScale:async()=>({uid:'id',resourceVersion:'1',replicas:1}),
  updateScale:async()=>{writes++;return {uid:'id',resourceVersion:'2',replicas:2};},
 },{load:async()=>hold?new Promise<string>(resolve=>{release=resolve;}):raw,save:async()=>{}});
 await workspace.load();workspace.setKind('deployments');await workspace.refresh();await workspace.openScale('web');
 workspace.setScaleReplicas('2');workspace.reviewScale();hold=true;
 const pending=workspace.submitScale();workspace.closeScale();release?.(raw);await pending;
 assert.equal(writes,0);assert.equal(workspace.getSnapshot().scale,undefined);assert.equal(workspace.getSnapshot().scaleNotice,undefined);
});

test('Pod 用量手動讀取、失敗清除舊數值，關閉後延遲結果不可復活', async () => {
 const usage={timestamp:'2026-09-24T00:00:00Z',windowSeconds:30,cpuMilli:150,memoryMiB:96,containers:[{name:'app',cpuMilli:150,memoryMiB:96}]};
 let pending:((value:typeof usage)=>void)|undefined;let calls=0;
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,
  listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
  getPodMetrics:async(config,namespace,name)=>{assert.equal(config,raw);assert.equal(namespace,'dev');assert.equal(name,'web');calls++;if(calls===2)throw new Error('metrics_unavailable');if(calls===3)return new Promise(resolve=>{pending=resolve;});return usage;},
 },{load:async()=>raw,save:async()=>{throw new Error('用量不可寫入儲存');}});
 await workspace.load();await workspace.refresh();assert.equal(calls,0);
 await workspace.openMetrics('web');assert.equal(workspace.getSnapshot().metrics?.value?.cpuMilli,150);
 await workspace.openMetrics('web');assert.equal(workspace.getSnapshot().metrics?.value,undefined);assert.equal(workspace.getSnapshot().metrics?.status,'error');
 const request=workspace.openMetrics('web');await Promise.resolve();workspace.closeMetrics();pending?.(usage);await request;
 assert.equal(workspace.getSnapshot().metrics,undefined);
 await workspace.openMetrics('web');workspace.setNamespace('other');assert.equal(workspace.getSnapshot().metrics,undefined);
});

test('切換叢集保存選擇、隔離過期查詢，AWS 缺漏只影響目前連線', async () => {
  const contexts = [profile, {context:'production',cluster:'eks',namespace:'prod'}];
  let stored = 'lab';
  let finish: ((value: {items: {name:string;namespace:string;phase:string;ready:number;total:number}[];hasMore:boolean}) => void) | undefined;
  const client = {...unusedResources, selectContext:async (_:string,name:string)=>name,
    inspect:async (value:string)=>({...contexts.find(item=>item.context===value)!,contexts}),
    listPods:async (value:string)=>{if(value==='production') throw new Error('aws_login_required');return new Promise<{items:{name:string;namespace:string;phase:string;ready:number;total:number}[];hasMore:boolean}>(resolve=>{finish=resolve;});}};
  const storage={load:async()=>stored,save:async(value:string)=>{stored=value;}};
  const workspace=new KubernetesWorkspace(client,storage);await workspace.load();
  const pending=workspace.refresh();await Promise.resolve();
  assert.equal(await workspace.selectContext('production'),true);
  finish?.({items:[{name:'old',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false});await pending;
  assert.deepEqual(workspace.getSnapshot().pods,[]);assert.equal(workspace.getSnapshot().namespace,'prod');
  const reopened=new KubernetesWorkspace(client,storage);await reopened.load();assert.equal(reopened.getSnapshot().profile?.context,'production');
  await reopened.refresh();assert.equal(reopened.getSnapshot().status,'error');assert.deepEqual(reopened.getSnapshot().pods,[]);
  assert.equal(await reopened.selectContext('lab'),true);assert.equal(reopened.getSnapshot().message,'');
});

test('叢集選擇儲存失敗保留原設定且未知 context 不寫入', async()=>{
 const contexts=[profile,{context:'other',cluster:'other',namespace:'prod'}];let writes=0;
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async raw=>({...contexts[raw==='other'?1:0],contexts}),selectContext:async(_,name)=>name,listPods:async()=>({items:[],hasMore:false})},
 {load:async()=> 'lab',save:async()=>{writes++;throw new Error('storage failure');}});
 await workspace.load();assert.equal(await workspace.selectContext('missing'),false);assert.equal(writes,0);
 assert.equal(await workspace.selectContext('other'),false);assert.equal(workspace.getSnapshot().profile?.context,'lab');assert.equal(workspace.getSnapshot().namespace,'dev');assert.equal(workspace.getSnapshot().configBusy,false);
});

test('namespace 分頁合併，切換叢集後丟棄延遲結果與錯誤',async()=>{
 let finish:((value:{items:string[];cursor:string})=>void)|undefined;let delayed=false;
 const contexts=[profile,{context:'other',cluster:'other',namespace:'default'}];let stored='lab';
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async raw=>({...contexts[raw==='other'?1:0],contexts}),selectContext:async(_,name)=>name,listPods:async()=>({items:[],hasMore:false}),
 listNamespaces:async(_,cursor)=>delayed?new Promise(resolve=>{finish=resolve;}):cursor?{items:['prod','dev'],cursor:''}:{items:['dev'],cursor:'next'}},
 {load:async()=>stored,save:async raw=>{stored=raw;}});
 await workspace.load();await workspace.refreshNamespaces();await workspace.refreshNamespaces(true);assert.deepEqual(workspace.getSnapshot().namespaces?.items,['dev','prod']);
 delayed=true;const pending=workspace.refreshNamespaces();await Promise.resolve();await workspace.selectContext('other');
 finish?.({items:['old'],cursor:''});await pending;assert.equal(workspace.getSnapshot().namespaces,undefined);
});

test('AWS profile 選擇保存並隔離舊結果，拒絕已停用與不存在的 profile',async()=>{
 let stored='original';let writes=0;
 const eks={clusterName:'eks',region:'ap-northeast-1',profile:'original',credentialKey:'key'};
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async raw=>({...profile,eks:{...eks,profile:raw}}),
 listAWSProfiles:async()=>[{name:'mobile',key:'key',region:eks.region,enabled:true,account:'123',arn:'arn'},{name:'disabled',key:'disabled',region:eks.region,enabled:false,account:'123',arn:'arn'}],
 selectAWSProfile:async(_,name)=>name||'original',listPods:async()=>({items:[{name:'old',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false})},
 {load:async()=>stored,save:async raw=>{writes++;stored=raw;}});
 await workspace.load();await workspace.refresh();assert.equal(await workspace.selectAWSProfile('disabled'),false);assert.equal(await workspace.selectAWSProfile('missing'),false);assert.equal(writes,0);
 assert.equal(await workspace.selectAWSProfile('mobile'),true);assert.equal(stored,'mobile');assert.deepEqual(workspace.getSnapshot().pods,[]);
 await workspace.load();assert.equal(workspace.getSnapshot().profile?.eks?.profile,'mobile');
 assert.equal(await workspace.selectAWSProfile(''),true);assert.equal(stored,'original');
});

test('清單用量延遲回覆不污染新 namespace；用量失敗仍保留資源',async()=>{
 let finish:((value:Record<string,import('../src/features/kubernetes/workspace.ts').PodMetrics>)=>void)|undefined;
 let fail=false;
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>profile,
 listPods:async(_,namespace)=>({items:[{name:'web',namespace,phase:'Running',ready:1,total:1}],hasMore:false}),
 listPodMetrics:async()=>{if(fail)throw new Error('metrics_missing');return new Promise(resolve=>{finish=resolve;});}},
 {load:async()=>raw,save:async()=>{}});
 await workspace.load();await workspace.refresh();workspace.setNamespace('prod');
 finish?.({web:{cpuMilli:24,memoryMiB:96,timestamp:'2026-09-25T00:00:00Z',windowSeconds:30,containers:[]}});await Promise.resolve();
 assert.equal(workspace.getSnapshot().listMetrics,undefined);
 fail=true;await workspace.refresh();await Promise.resolve();assert.equal(workspace.getSnapshot().status,'ready');assert.equal(workspace.getSnapshot().pods[0].namespace,'prod');assert.equal(workspace.getSnapshot().listMetrics,undefined);assert.equal(workspace.getSnapshot().listMetricsMessage,'用量暫無資料');
});
