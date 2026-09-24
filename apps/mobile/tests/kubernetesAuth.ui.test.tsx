const mockNative = {
 inspectKubeContexts: jest.fn(async()=>JSON.stringify({context:'prod',cluster:'eks',namespace:'default',eks:{profile:'work'}})),
 selectKubeContext: jest.fn(async(raw:string)=>raw),
 listKubePods: jest.fn(async()=>JSON.stringify({items:[],hasMore:false})),
};
const mockAuthorize = jest.fn();
jest.mock('expo',()=>({requireNativeModule:()=>mockNative}));
jest.mock('../src/storage/aws',()=>({awsRepository:{authorize:(...args:unknown[])=>mockAuthorize(...args)}}));
jest.mock('../src/storage/kubeconfig',()=>({kubeconfigStorage:{load:async()=> 'encrypted-storage-fixture',save:async()=>{}}}));


test('缺少或停用 AWS profile 時顯示原因且不送出 Kubernetes 請求',async()=>{
 const { kubernetesWorkspace } = jest.requireActual<typeof import('../src/storage/kubernetes')>('../src/storage/kubernetes');
 for(const [code,message] of [['aws_login_required','請先在設定新增並啟用同名 AWS profile。'],['aws_profile_disabled','此 AWS profile 已停用。']]) {
  mockAuthorize.mockRejectedValueOnce(new Error(code));await kubernetesWorkspace.load();await kubernetesWorkspace.refresh();
  expect(kubernetesWorkspace.getSnapshot().status).toBe('error');expect(kubernetesWorkspace.getSnapshot().message).toBe(message);expect(mockNative.listKubePods).not.toHaveBeenCalled();
 }
 mockAuthorize.mockResolvedValueOnce('temporary-token-config');await kubernetesWorkspace.refresh();
 expect(mockNative.listKubePods).toHaveBeenCalledWith('temporary-token-config','default');expect(kubernetesWorkspace.getSnapshot().status).toBe('ready');
});
