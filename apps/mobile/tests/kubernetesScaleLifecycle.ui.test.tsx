import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { KubernetesProvider } from '../src/features/kubernetes/KubernetesProvider';
import Kubernetes from '../src/app/(tabs)/kubernetes';
import { KubernetesWorkspace } from '../src/features/kubernetes/workspace';

// 保留實際 ScrollView 的 RefreshControl 容器切換，避免預設 mock 掩蓋子樹重建。
jest.unmock('react-native/Libraries/Components/ScrollView/ScrollView');
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

test('Scale 完成後等待列表重查時，保留同一個原生視窗與關閉按鈕',async()=>{
 let scaleSent=false;
 let finishReload!:(value:import('../src/features/kubernetes/workspace').ResourceList)=>void;
 const resource={name:'api',namespace:'dev',ready:0,desired:0,updated:0,keyCount:0,immutable:false};
 const workspace=new KubernetesWorkspace({...unusedResources,inspect:async()=>({context:'qa',cluster:'local',namespace:'dev'}),listPods:async()=>({items:[],hasMore:false}),
  listResources:async()=>scaleSent?new Promise(resolve=>{finishReload=resolve;}):{items:[resource],hasMore:false},
  getScale:async()=>({uid:'id',resourceVersion:'7',replicas:0}),
  updateScale:async()=>{scaleSent=true;return {uid:'id',resourceVersion:'8',replicas:1};},
 },{load:async()=>'config',save:async()=>{}});
 await render(<SafeAreaProvider initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:59,left:0,right:0,bottom:34}}}><KubernetesProvider workspace={workspace}><Kubernetes /></KubernetesProvider></SafeAreaProvider>);
 await screen.findByText('local');
 await fireEvent.press(screen.getByRole('button',{name:'選擇資源類型'}));
 await fireEvent.press(screen.getByRole('radio',{name:'Deployment'}));
 await fireEvent.press(await screen.findByRole('button',{name:'查看 api'}));
 await fireEvent.press(screen.getByRole('button',{name:'調整 api 副本數'}));
 await screen.findByLabelText('副本數');
 const close=screen.getByRole('button',{name:'關閉副本設定'});
 await fireEvent.press(screen.getByRole('button',{name:'增加副本數'}));
 await fireEvent.press(screen.getByRole('button',{name:'檢查變更'}));
 await fireEvent.press(screen.getByRole('button',{name:'確認調整'}));
 await screen.findByText('副本數已更新。');
 expect(screen.getByRole('button',{name:'關閉副本設定'})===close).toBe(true);
 await act(async()=>{finishReload({items:[{...resource,desired:1}],hasMore:false});});
 expect(screen.getByRole('button',{name:'關閉副本設定'})===close).toBe(true);
 await fireEvent.press(close);
 expect(screen.queryByRole('button',{name:'關閉副本設定'})).toBeNull();
 expect(screen.getByRole('button',{name:'調整 api 副本數'})).toBeTruthy();
});
