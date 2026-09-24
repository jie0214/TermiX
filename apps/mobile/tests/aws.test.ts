import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AwsRepository, type AwsNative, type EksConfig } from '../src/features/aws/repository.ts';
const key = `termix.aws.${'a'.repeat(64)}`;
const eks: EksConfig = { clusterName:'lab',region:'ap-northeast-1',profile:'work',credentialKey:key };
const credentials={accessKeyId:'AKIATESTONLY12345678',secretAccessKey:'test-only-secret',sessionToken:''};
function setup() {
 const data=new Map<string,string>();
 const vault={get:async(k:string)=>data.get(k)??null,set:async(k:string,v:string)=>{data.set(k,v)},remove:async(k:string)=>{data.delete(k)}};
 let count=0;
 const native: AwsNative={awsProfileKey:async()=>key,loginAWS:async()=>JSON.stringify({account:'123456789012',arn:'test-identity'}),authorizeEKS:async()=>`token-${++count}`};
 return {data,vault,native,repository:new AwsRepository(vault,native)};
}
test('AWS profile 重開保留，停用阻止操作，啟用後 token 每次更新，刪除移除憑證',async()=>{
 const {repository,vault,native,data}=setup();
 await repository.save('work',eks.region,credentials);
 const restored=new AwsRepository(vault,native);
 assert.equal((await restored.list())[0].enabled,true);
 assert.ok(!JSON.stringify(await restored.list()).includes(credentials.secretAccessKey));
 assert.equal(await restored.authorize('raw',eks),'token-1');
 assert.equal(await restored.authorize('raw',eks),'token-2');
 await restored.setEnabled(key,false);
 await restored.save('work',eks.region,credentials);
 assert.equal((await restored.list())[0].enabled,false);
 await assert.rejects(restored.authorize('raw',eks),/aws_profile_disabled/);
 await restored.setEnabled(key,true);
 assert.equal(await restored.authorize('raw',eks),'token-3');
 await restored.remove(key);
 assert.equal(data.has(key),false);assert.deepEqual(await restored.list(),[]);
 await assert.rejects(restored.authorize('raw',eks),/aws_login_required/);
});
test('AWS 驗證或保存失敗不覆蓋舊憑證，刪除中途失敗可復原',async()=>{
 const {repository,vault,native,data}=setup();
 await repository.save('work',eks.region,credentials);
 const before=data.get(key);
 const reject=new AwsRepository(vault,{...native,loginAWS:async()=>{throw new Error('aws_credentials_invalid')}});
 await assert.rejects(reject.save('work',eks.region,{...credentials,secretAccessKey:'replacement'}));assert.equal(data.get(key),before);
 const broken=new AwsRepository({...vault,set:async(k,v)=>{if(k.endsWith('profiles.v1'))throw new Error('disk');await vault.set(k,v)}},native);
 await assert.rejects(broken.save('work',eks.region,{...credentials,secretAccessKey:'replacement'}));assert.equal(data.get(key),before);
 await assert.rejects(broken.remove(key));assert.equal(data.get(key),before);
 assert.equal((await repository.list()).length,1);
});
test('停用或刪除期間較晚產生的 EKS token 不得送往叢集',async()=>{
 for(const remove of [false,true]){
  const {repository,native}=setup();
  await repository.save('work',eks.region,credentials);
  let complete!:(value:string)=>void;
  native.authorizeEKS=async()=>new Promise(resolve=>{complete=resolve});
  const pending=repository.authorize('raw',eks);
  while(!complete) await new Promise(resolve=>setImmediate(resolve));
  if(remove)await repository.remove(key);else await repository.setEnabled(key,false);
  complete('late-secret-token');await assert.rejects(pending,/aws_login_required/);
 }
});
test('AWS profiles 同時操作依序完成，損毀索引不允許覆蓋',async()=>{
 const {repository,data}=setup();
 await repository.save('work',eks.region,credentials);
 await Promise.all([repository.setEnabled(key,false),repository.setEnabled(key,true)]);
 assert.equal((await repository.list())[0].enabled,true);
 data.set('termix.aws.profiles.v1','broken');
 await assert.rejects(repository.save('work',eks.region,credentials));
 assert.equal(data.get('termix.aws.profiles.v1'),'broken');
});
