import KubernetesSettings from '../src/app/settings/kubernetes';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KubernetesProvider } from '../src/features/kubernetes/KubernetesProvider';
import { KubeImportButton } from '../src/features/kubernetes/KubeImportButton';
import Kubernetes from '../src/app/(tabs)/kubernetes';
import { KubernetesWorkspace } from '../src/features/kubernetes/workspace';

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

  await screen.findByText('此帳號沒有查看此資源的權限。');
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
  await fireEvent.press(screen.getByRole('radio',{name:'Deployment'}));

  await screen.findByText('就緒 2/3 · 已更新 1');
  await fireEvent.press(screen.getByRole('radio',{name:'StatefulSet'}));

  await screen.findByText('api');
  await fireEvent.press(screen.getByRole('radio',{name:'ConfigMap'}));

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

test('縮放面板要求確認，顯示目標與零副本影響，再送出變更', async () => {
 const updateScale=jest.fn(async()=>({uid:'id',resourceVersion:'8',replicas:0}));
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>({items:[{name:'api',namespace:'dev',ready:3,desired:3,updated:3,keyCount:0,immutable:false}],hasMore:false}),
  getScale:async()=>({uid:'id',resourceVersion:'7',replicas:3}),updateScale,
 },{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByText('local');
 await fireEvent.press(screen.getByRole('radio',{name:'Deployment'}));

 await fireEvent.press(await screen.findByRole('button',{name:'查看 api'}));
 await fireEvent.press(await screen.findByRole('button',{name:'調整 api 副本數'}));
 await screen.findByLabelText('期望副本數');
 await fireEvent.changeText(screen.getByLabelText('期望副本數'),'1.5');
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 expect(screen.getByText('請輸入 0 至 2147483647 的整數副本數。')).toBeTruthy();
 await fireEvent.changeText(screen.getByLabelText('期望副本數'),'0');
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 expect(updateScale).not.toHaveBeenCalled();
 expect(screen.getByText('dev · Deployment · api')).toBeTruthy();
 expect(screen.getByText('3 → 0')).toBeTruthy();
 expect(screen.getByText('設為 0 將停止此工作負載的所有副本。')).toBeTruthy();
 await fireEvent.press(screen.getByRole('button',{name:'返回修改'}));
 expect(updateScale).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 await fireEvent.press(screen.getByRole('button',{name:'確認調整'}));
 await screen.findByText('叢集已接受期望副本數 0，不代表已就緒；請重新查詢。');
 expect(updateScale).toHaveBeenCalledTimes(1);
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
