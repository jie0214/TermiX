import { ScrollView } from 'react-native';
import KubernetesSettings from '../src/app/settings/kubernetes';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KubernetesProvider } from '../src/features/kubernetes/KubernetesProvider';
import { KubeImportButton } from '../src/features/kubernetes/KubeImportButton';
import Kubernetes from '../src/app/(tabs)/kubernetes';
import { KubernetesWorkspace } from '../src/features/kubernetes/workspace';

jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl',()=>{
 const {View}=jest.requireActual('react-native');
 return {__esModule:true,default:(props:import('react-native').RefreshControlProps)=><View {...props}/>};
});

const unusedResources = {
 deleteResource: async()=>{throw new Error('非預期刪除');},
  getDocument: async () => { throw new Error('非預期 YAML 查詢'); },
  updateDocument: async () => { throw new Error('非預期資源寫入'); },
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
jest.mock('expo-router',()=>({router:{push:jest.fn(),back:jest.fn()},useFocusEffect:(callback:()=>void)=>{jest.requireActual('react').useEffect(callback,[callback]);}}));

jest.mock('../src/storage/kubeconfig', () => ({ pickKubeconfig: jest.fn(async () => 'token-only-test-config') }));

test('設定匯入後查看目前 namespace 的 Pod，切換 namespace 後重新查詢', async () => {
  let stored: string | null = null;
  const namespaces: string[] = [];
  const workspace = new KubernetesWorkspace({ ...unusedResources,
    inspect: async () => ({ context: 'qa', cluster: 'local', namespace: 'dev' }),
    listPods: async (_, namespace) => { namespaces.push(namespace); return { items: [{ name: 'api-0', namespace, phase: 'Running', ready: 1, total: 1 }], hasMore: false }; },
  }, {load:async()=>stored,save:async value=>{stored=value;}});
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><KubeImportButton /><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
  await fireEvent.press(screen.getByRole('button',{name:'匯入 kubeconfig'}));
  await screen.findByText('api-0');
  expect(screen.getByText('local · qa')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'選擇叢集'})).toBeNull();
  expect(JSON.stringify(workspace.getSnapshot())).not.toContain('token-only-test-config');

  await screen.findByText('api-0');
  expect(screen.getByText('1/1 就緒 · Running')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'namespace'}));
  await fireEvent.press(await screen.findByRole('radio',{name:'staging'}));

  await waitFor(()=>expect(namespaces).toEqual(['dev','staging']));
  expect(screen.getByText('api-0')).toBeTruthy();
});

test('權限不足時只顯示錯誤，不沿用舊 Pod', async () => {
  const workspace = new KubernetesWorkspace({ ...unusedResources, inspect: async () => ({ context:'qa',cluster:'local',namespace:'dev' }),
    listPods:async()=>{throw new Error('forbidden');} },{load:async()=> 'test-config',save:async()=>{}});
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
  await screen.findByText('local');

  await screen.findByText('此帳號沒有執行此資源操作的權限。');
  expect(screen.queryByText('api-0')).toBeNull();
});

test('切換資源查看副本，點開 ConfigMap 並關閉內容', async () => {
  const calls: string[] = [];
  const workspace = new KubernetesWorkspace({ ...unusedResources,
    inspect: async () => ({context:'qa',cluster:'local',namespace:'dev'}),
    listPods: async () => ({items:[],hasMore:false}),
    listResources: async (_, namespace, kind) => { calls.push(kind); return {items:[{name:kind==='configmaps'?'settings':'api',namespace,ready:2,desired:3,updated:1,keyCount:2,immutable:true}],hasMore:false}; },
    getConfigMap: async (_,namespace,name) => ({name,namespace,immutable:true,entries:[{key:'app.conf',value:'mode=prod',binary:false,bytes:9,truncated:false},{key:'asset',value:'',binary:true,bytes:3,truncated:false}],truncated:false}),
  }, {load:async()=>'config',save:async()=>{}});
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
  await screen.findByText('local');
  await fireEvent.press(screen.getByRole('button',{name:'選擇資源類型'}));
 await fireEvent.press(screen.getByRole('radio',{name:'Deployment'}));

  await screen.findByText('2/3 就緒');
  await fireEvent.press(screen.getByRole('button',{name:'選擇資源類型'}));
 await fireEvent.press(screen.getByRole('radio',{name:'StatefulSet'}));

  await screen.findByText('api');
  await fireEvent.press(screen.getByRole('radio',{name:'Configuration'}));

  await screen.findByText('settings');
  expect(screen.queryByText('mode=prod')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'查看 settings'}));
  await screen.findByText('mode=prod');
  expect(screen.getByText('二進位資料 · 3 bytes')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'關閉內容'}));
  expect(screen.queryByText('mode=prod')).toBeNull();
  expect(calls).toEqual(['deployments','statefulsets','configmaps']);
});

test('Pod Log 可選容器、切換前次紀錄、重新整理及關閉', async () => {
  const calls: string[] = [];
  const workspace = new KubernetesWorkspace({ ...unusedResources,
    inspect: async () => ({context:'qa',cluster:'local',namespace:'dev'}),
    listPods: async () => ({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:2}],hasMore:false}),
    getPodContainers: async () => ({containers:[{name:'app',kind:'regular'},{name:'setup',kind:'init'}]}),
    getPodLogs: async (_,namespace,pod,container,previous) => {
      calls.push(`${namespace}/${pod}/${container}/${previous}`);
      return {text:`${container} ${previous?'previous':'current'} log`,truncated:false};
    },
  },{load:async()=>'test-config',save:async()=>{}});
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
  await screen.findByText('local');

  await screen.findByText('web');
  await fireEvent.press(screen.getByRole('button',{name:'查看 web'}));
  await fireEvent.press(screen.getByRole('button',{name:'查看 web Log'}));
  await screen.findByText('app current log');
  await fireEvent.press(screen.getByRole('radio',{name:'setup（初始化）'}));
  await screen.findByText('setup current log');
  await fireEvent(screen.getByRole('switch',{name:'前次執行'}), 'valueChange', true);
  await screen.findByText('setup previous log');
  await fireEvent.press(screen.getByRole('button',{name:'重新整理 Log'}));
  await waitFor(()=>expect(calls).toHaveLength(4));
  await fireEvent.press(screen.getByRole('button',{name:'關閉 Log'}));
  expect(screen.queryByText('setup previous log')).toBeNull();
});

test('縮放面板要求確認，顯示目標與副本差異，再送出變更', async () => {
 const updateScale=jest.fn(async()=>({uid:'id',resourceVersion:'8',replicas:0}));
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>({items:[{name:'api',namespace:'dev',ready:3,desired:3,updated:3,keyCount:0,immutable:false}],hasMore:false}),
  getScale:async()=>({uid:'id',resourceVersion:'7',replicas:3}),updateScale,
 },{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByText('local');
 await fireEvent.press(screen.getByRole('button',{name:'選擇資源類型'}));
 await fireEvent.press(screen.getByRole('radio',{name:'Deployment'}));

 await fireEvent.press(await screen.findByRole('button',{name:'查看 api'}));
 await fireEvent.press(await screen.findByRole('button',{name:'調整 api 副本數'}));
 await screen.findByLabelText('副本數');
 await fireEvent.press(screen.getByRole('button',{name:'增加副本數'}));
 expect(screen.getByLabelText('副本數').props.value).toBe('4');
 await fireEvent.press(screen.getByRole('button',{name:'減少副本數'}));
 expect(screen.getByLabelText('副本數').props.value).toBe('3');
 await fireEvent.changeText(screen.getByLabelText('副本數'),'1.5');
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 expect(screen.getByText('請輸入 0 至 2147483647 的整數副本數。')).toBeTruthy();
 await fireEvent.changeText(screen.getByLabelText('副本數'),'0');
 expect(screen.getByRole('button',{name:'減少副本數'})).toBeDisabled();
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 expect(updateScale).not.toHaveBeenCalled();
 expect(screen.getByText('dev · Deployment · api')).toBeTruthy();
 expect(screen.getByText('3 → 0')).toBeTruthy();

 await fireEvent.press(screen.getByRole('button',{name:'返回修改'}));
 expect(updateScale).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 await fireEvent.press(screen.getByRole('button',{name:'確認調整'}));
 await screen.findByText('副本數已更新。');
 expect(updateScale).toHaveBeenCalledTimes(1);
 await fireEvent.press(screen.getByRole('button',{name:'關閉副本設定'}));
 expect(screen.queryByRole('button',{name:'關閉副本設定'})).toBeNull();
 await fireEvent.press(await screen.findByRole('button',{name:'調整 api 副本數'}));
 await screen.findByLabelText('副本數');
 await fireEvent.press(screen.getByRole('button',{name:'關閉副本設定'}));
 expect(screen.getByRole('button',{name:'調整 api 副本數'})).toBeTruthy();
});

test('Pod 用量面板顯示採樣、合計與容器，無資料可重試且不顯示假的零', async () => {
 let calls=0;
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),
  listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
  getPodMetrics:async()=>{calls++;if(calls===2)throw new Error('metrics_missing');return {timestamp:'2026-09-24T00:00:00Z',windowSeconds:30,cpuMilli:125,memoryMiB:64,containers:[{name:'app',cpuMilli:125,memoryMiB:64},{name:'idle',cpuMilli:0.000001,memoryMiB:0}]};},
 },{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByText('local');

 await fireEvent.press(await screen.findByRole('button',{name:'查看 web'}));
 await fireEvent.press(await screen.findByRole('button',{name:'查看 web 用量'}));
 await screen.findByText('已回報容器合計');
 expect(screen.getByText('採樣 2026-09-24T00:00:00Z · 區間 30 秒')).toBeTruthy();
 expect(screen.getAllByText('125 m / 上限未知')).toHaveLength(2);
 expect(screen.getByText('<0.01 m / 上限未知')).toBeTruthy();
 await fireEvent.press(screen.getByRole('button',{name:'重新整理用量'}));
 await screen.findByText('此 Pod 尚無用量資料，或叢集未提供 Metrics API。');
 expect(screen.queryByText('已回報容器合計')).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'重新整理用量'}));await screen.findByText('已回報容器合計');
 await fireEvent.press(screen.getByRole('button',{name:'關閉用量'}));expect(screen.queryByText('已回報容器合計')).toBeNull();
});

test('叢集選單可搜尋並切換 kubeconfig context',async()=>{
 const contexts=[{context:'qa',cluster:'local',namespace:'dev'},{context:'prod',cluster:'production',namespace:'default'}];let stored='qa';
 const workspace=new KubernetesWorkspace({...unusedResources,selectContext:async(_,name)=>name,
 inspect:async raw=>({...contexts.find(item=>item.context===raw)!,contexts}),listPods:async()=>({items:[],hasMore:false})},
 {load:async()=>stored,save:async raw=>{stored=raw;}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><KubernetesSettings/></KubernetesProvider></SafeAreaProvider>);
 await fireEvent.press(await screen.findByRole('button',{name:'叢集 · local'}));
 await fireEvent.changeText(screen.getByLabelText('搜尋叢集'),'production');expect(screen.queryByRole('radio',{name:'local · qa'})).toBeNull();
 await fireEvent.press(screen.getByRole('radio',{name:'production · prod'}));await waitFor(()=>expect(stored).toBe('prod'));
 expect(workspace.getSnapshot().namespace).toBe('default');
});

test('選擇 AWS profile 後重新取得 namespace，搜尋資源且顯示健康狀態',async()=>{
 let stored='original';const namespaceProfiles:string[]=[];
 const workspace=new KubernetesWorkspace({...unusedResources,
 inspect:async raw=>({context:'qa',cluster:'eks',namespace:'dev',eks:{profile:raw,region:'ap-northeast-1',clusterName:'eks',credentialKey:raw}}),
 listAWSProfiles:async()=>[{name:'mobile',key:'mobile',region:'ap-northeast-1',enabled:true,account:'123',arn:'arn'}],selectAWSProfile:async(_,name)=>name,
 listNamespaces:async raw=>{namespaceProfiles.push(raw);return {items:['dev','prod'],cursor:''};},
 listPods:async(_,namespace)=>({items:[{name:'api-good',namespace,phase:'Running',ready:1,total:1,health:'healthy'},{name:'api-bad',namespace,phase:'Running',ready:0,total:1,health:'unhealthy'}],hasMore:false})},
 {load:async()=>stored,save:async raw=>{stored=raw;}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><KubernetesSettings/><Kubernetes/></KubernetesProvider></SafeAreaProvider>);
 await fireEvent.press(await screen.findByRole('button',{name:'雲端帳號 · original'}));await fireEvent.press(await screen.findByRole('radio',{name:'mobile'}));
 await screen.findByRole('button',{name:'雲端帳號 · mobile'});await waitFor(()=>expect(namespaceProfiles).toContain('mobile'));
 await fireEvent.press(screen.getByRole('button',{name:'namespace'}));await fireEvent.press(await screen.findByRole('radio',{name:'prod'}));
await screen.findByText('健康');expect(screen.getByText('不健康')).toBeTruthy();
 await fireEvent.press(screen.getByRole('button',{name:'只看異常'}));expect(screen.queryByText('api-good')).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'只看異常'}));expect(screen.getByText('api-good')).toBeTruthy();
 await fireEvent.changeText(screen.getByLabelText('搜尋資源名稱'),'BAD');expect(screen.queryByText('api-good')).toBeNull();expect(screen.getByText('api-bad')).toBeTruthy();
 await fireEvent.changeText(screen.getByLabelText('搜尋資源名稱'),'missing');expect(screen.getByText('找不到符合的資源')).toBeTruthy();
});

test('使用者可檢視與編輯 YAML，確認後才寫入',async()=>{
 const updateDocument=jest.fn(async()=>({yaml:'kind: Pod',uid:'id',resourceVersion:'8',containers:[]}));
 const ws=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),
 listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
 getDocument:async()=>({yaml:'kind: Pod',uid:'id',resourceVersion:'7',containers:[]}),updateDocument},{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={ws}><Kubernetes/></KubernetesProvider></SafeAreaProvider>);
 await fireEvent.press(await screen.findByRole('button',{name:'查看 web'}));
 await fireEvent.press(screen.getByRole('button',{name:'查看 YAML'}));
 await fireEvent.press(await screen.findByRole('button',{name:'編輯 YAML'}));
 await fireEvent.changeText(screen.getByLabelText('YAML 內容'),'kind: Pod\nmetadata: {}');
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 expect(updateDocument).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'確認儲存'}));
 await screen.findByText('叢集已接受變更，請重新查詢資源狀態。');
 expect(updateDocument).toHaveBeenCalledTimes(1);
});


test('每次 Log 更新都捲到最後，即使回傳內容相同',async()=>{
 const scroll=jest.spyOn(ScrollView.prototype,'scrollToEnd').mockImplementation(()=>{});
 try {
  const ws=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),
   listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
   getPodContainers:async()=>({containers:[{name:'app',kind:'regular' as const}]}),getPodLogs:async()=>({text:'old\nlatest',truncated:false})},{load:async()=>'config',save:async()=>{}});
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={ws}><Kubernetes/></KubernetesProvider></SafeAreaProvider>);
  await fireEvent.press(await screen.findByRole('button',{name:'查看 web'}));
  await fireEvent.press(screen.getByRole('button',{name:'查看 web Log'}));
  await screen.findByText('old\nlatest');
  await waitFor(()=>expect(scroll).toHaveBeenCalled());scroll.mockClear();
  await fireEvent.press(screen.getByRole('button',{name:'重新整理 Log'}));
  await waitFor(()=>expect(scroll).toHaveBeenCalled());
 } finally {scroll.mockRestore();}
});

test('image 面板顯示一般與初始化容器，修改選定容器後確認送出',async()=>{
 const containers=[{name:'app',group:'containers' as const,image:'nginx:old'},{name:'setup',group:'initContainers' as const,image:'setup:v1'}];
 const updateDocument=jest.fn(async()=>({yaml:'kind: Pod',uid:'id',resourceVersion:'8',containers}));
 const ws=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),
 listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
 getDocument:async()=>({yaml:'kind: Pod',uid:'id',resourceVersion:'7',containers}),updateDocument},{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={ws}><Kubernetes/></KubernetesProvider></SafeAreaProvider>);
 await fireEvent.press(await screen.findByRole('button',{name:'查看 web'}));
 await fireEvent.press(screen.getByRole('button',{name:'變更 image'}));
 await screen.findByText('nginx:old');
 await fireEvent.press(await screen.findByRole('button',{name:'變更 setup image'}));
 await fireEvent.changeText(screen.getByLabelText('容器 image'),'setup:v2');
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 await screen.findByText('setup:v1 → setup:v2');expect(updateDocument).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'確認儲存'}));
 await screen.findByText('叢集已接受變更，請重新查詢資源狀態。');
 expect(updateDocument).toHaveBeenCalledWith('config','dev','pods','web',{uid:'id',resourceVersion:'7',container:{name:'setup',group:'initContainers',image:'setup:v2'}});
});

test('刪除資源直接再次確認，取消不送出',async()=>{
 const deleteResource=jest.fn(async()=>{});
 const workspace=new KubernetesWorkspace({...unusedResources,deleteResource,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),
 listPods:async()=>({items:[{name:'web',namespace:'dev',phase:'Running',ready:1,total:1}],hasMore:false}),
 getDocument:async()=>({yaml:'kind: Pod',uid:'id',resourceVersion:'7',containers:[]})},{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await fireEvent.press(await screen.findByRole('button',{name:'查看 web'}));
 await fireEvent.press(screen.getByRole('button',{name:'刪除資源'}));
 const confirm=await screen.findByRole('button',{name:'再次確認刪除'});
 expect(confirm).toBeEnabled();
 expect(screen.queryByRole('checkbox')).toBeNull();
 expect(deleteResource).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'取消'}));expect(deleteResource).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'刪除資源'}));
 await fireEvent.press(await screen.findByRole('button',{name:'再次確認刪除'}));
 await screen.findByText('已送出刪除要求。');
 expect(deleteResource).toHaveBeenCalledTimes(1);
 expect(deleteResource).toHaveBeenCalledWith('config','dev','pods','web',{uid:'id',resourceVersion:'7'});
});

test('每 10 秒靜默更新，列表保持掛載且不顯示刷新按鈕，進入背景及離頁停止查詢',async()=>{
 jest.useFakeTimers();
 const listeners=new Set<(state:import('react-native').AppStateStatus)=>void>();
 const {AppState}=jest.requireActual('react-native');
 const originalListener=AppState.addEventListener.getMockImplementation();
 const listener=jest.spyOn(AppState,'addEventListener').mockImplementation((...args:unknown[])=>{const fn=args[1] as (state:import('react-native').AppStateStatus)=>void;listeners.add(fn);return {remove:()=>listeners.delete(fn)};});
 let count=0;let finish!:(value:import('../src/features/kubernetes/workspace').PodList)=>void;
 const pod={name:'web',namespace:'dev',phase:'Running',ready:1,total:1};
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>{count++;return count===2?new Promise(resolve=>{finish=resolve;}):{items:[pod],hasMore:false};}},{load:async()=>'config',save:async()=>{}});
 try {
  await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
  await screen.findByRole('button',{name:'查看 web'});
  const row=screen.getByRole('button',{name:'查看 web'});expect(screen.queryByRole('button',{name:'查看 Pod'})).toBeNull();
  await act(async()=>{jest.advanceTimersByTime(10_000);});
  expect(count).toBe(2);expect(screen.getByRole('button',{name:'查看 web'})).toBe(row);expect(screen.queryByRole('button',{name:'查看 Pod'})).toBeNull();expect(screen.queryByText('讀取中…')).toBeNull();
  await act(async()=>{jest.advanceTimersByTime(20_000);});expect(count).toBe(2);
  await act(async()=>{finish({items:[{...pod,ready:0}],hasMore:false});});await screen.findByText('0/1 就緒 · Running');
  await act(async()=>{listeners.forEach(fn=>fn('background'));jest.advanceTimersByTime(30_000);});expect(count).toBe(2);
  await act(async()=>{listeners.forEach(fn=>fn('active'));});expect(count).toBe(3);
  await screen.unmount();await act(async()=>{jest.advanceTimersByTime(30_000);});expect(count).toBe(3);
 }finally{listener.mockImplementation(originalListener);jest.useRealTimers();}
});

test('下拉刷新保留列表並更新結果，不顯示整理按鈕',async()=>{
 let calls=0;let finish!:(value:import('../src/features/kubernetes/workspace').PodList)=>void;
 const pod={name:'web',namespace:'dev',phase:'Running',ready:1,total:1};
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>{calls++;return calls===1?{items:[pod],hasMore:false}:new Promise(resolve=>{finish=resolve;});}},{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByRole('button',{name:'查看 web'});
 expect(screen.queryByRole('button',{name:'查看 Pod'})).toBeNull();
 await fireEvent(screen.getByLabelText('下拉刷新'),'refresh');
 expect(calls).toBe(2);expect(screen.getByLabelText('下拉刷新').props.refreshing).toBe(true);expect(screen.getByRole('button',{name:'查看 web'})).toBeTruthy();expect(screen.queryByText('讀取中…')).toBeNull();
 await act(async()=>{finish({items:[{...pod,ready:0}],hasMore:false});});
 await screen.findByText('0/1 就緒 · Running');expect(screen.getByLabelText('下拉刷新').props.refreshing).toBe(false);
 await screen.unmount();
});

test('新增分類可查詢資源與唯讀 YAML，不提供修改或刪除',async()=>{
 const listResources=jest.fn(async()=>({items:[{name:'reader',namespace:'dev',ready:0,desired:0,updated:0,keyCount:0,immutable:false,detail:'Rules 1'}],hasMore:false}));
 const getDocument=jest.fn(async()=>({yaml:'kind: Role\nrules: []',uid:'id',resourceVersion:'7',containers:[]}));
 const workspace=new KubernetesWorkspace({...unusedResources,listResources,getDocument,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>({items:[],hasMore:false})},{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByText('此 namespace 沒有 Pod');
 await fireEvent.press(screen.getByRole('radio',{name:'Access Control'}));
 await screen.findByRole('button',{name:'查看 reader'});
 expect(listResources).toHaveBeenLastCalledWith('config','dev','serviceaccounts');
 await fireEvent.press(screen.getByRole('button',{name:'選擇資源類型'}));
 await fireEvent.press(screen.getByRole('radio',{name:'Role'}));
 await screen.findByRole('button',{name:'查看 reader'});
 expect(listResources).toHaveBeenLastCalledWith('config','dev','roles');
 await fireEvent.press(screen.getByRole('button',{name:'查看 reader'}));
 expect(screen.queryByRole('button',{name:'刪除資源'})).toBeNull();
 expect(screen.queryByRole('button',{name:'變更 image'})).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'查看 YAML'}));
 await screen.findByText('kind: Role\nrules: []');
 expect(getDocument).toHaveBeenCalledWith('config','dev','roles','reader');
 expect(screen.queryByRole('button',{name:'編輯 YAML'})).toBeNull();
 await act(async()=>{workspace.editDocument();await workspace.openDelete('reader');});
 expect(workspace.getSnapshot().editor?.status).toBe('viewing');
 expect(workspace.getSnapshot().deletion).toBeUndefined();
});


test.each(['success','forbidden'] as const)('Scale 請求尚未完成時關閉，%s 回應不會重新開啟視窗',async outcome=>{
 let resolve!:(value:{uid:string;resourceVersion:string;replicas:number})=>void;
 let reject!:(error:Error)=>void;
 const updateScale=jest.fn(()=>new Promise<{uid:string;resourceVersion:string;replicas:number}>((done,fail)=>{resolve=done;reject=fail;}));
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>({items:[{name:'api',namespace:'dev',ready:1,desired:1,updated:1,keyCount:0,immutable:false}],hasMore:false}),
  getScale:async()=>({uid:'id',resourceVersion:'7',replicas:1}),updateScale,
 },{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByText('local');
 await fireEvent.press(screen.getByRole('button',{name:'選擇資源類型'}));
 await fireEvent.press(screen.getByRole('radio',{name:'Deployment'}));
 await fireEvent.press(await screen.findByRole('button',{name:'查看 api'}));
 await fireEvent.press(screen.getByRole('button',{name:'調整 api 副本數'}));
 await screen.findByLabelText('副本數');
 await fireEvent.changeText(screen.getByLabelText('副本數'),'2');
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 await fireEvent.press(screen.getByRole('button',{name:'確認調整'}));
 await screen.findByText('送出中…關閉畫面不會撤回已送出的變更。');
 await fireEvent.press(screen.getByRole('button',{name:'關閉副本設定'}));
 expect(screen.queryByRole('button',{name:'關閉副本設定'})).toBeNull();
 await act(async()=>{if(outcome==='success')resolve({uid:'id',resourceVersion:'8',replicas:2});else reject(new Error('forbidden'));});
 await screen.findByText(outcome==='success'?'副本數已更新。':'此帳號沒有調整副本數的權限。');
 expect(screen.queryByRole('button',{name:'關閉副本設定'})).toBeNull();
 expect(updateScale).toHaveBeenCalledTimes(1);
 await fireEvent.press(await screen.findByRole('button',{name:'調整 api 副本數'}));
 await screen.findByLabelText('副本數');
 await fireEvent.press(screen.getByRole('button',{name:'關閉副本設定'}));
 expect(screen.getByRole('button',{name:'返回資源'})).toBeTruthy();
});
