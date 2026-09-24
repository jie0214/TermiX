import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TerminalSession } from '../src/features/terminal/session.ts';
import type { SSHConfig, SSHEvent, SSHTransport } from '../src/features/terminal/contracts.ts';
import type { Host } from '../src/features/hosts/repository.ts';

const host: Host = { id:'host', name:'測試',address:'example.com',port:22,username:'test',authType:'password' };
function fixture() {
  const events: SSHEvent[] = [];
  const starts: SSHConfig[] = [];
  const writes: string[] = [];
  const keys = new Map<string,string>();
  const transport: SSHTransport = {
    start: async c => { starts.push(c); }, poll: async () => events.splice(0),
    trust: async (_,accept) => { if (accept) events.push({type:'connected'}); },
    write: async (_,data) => { writes.push(data); },resize: async () => {},disconnect: async () => {},
  };
  const session = new TerminalSession(transport, {updatePrivateKeyPassphrase:async()=>{},getCredentials:async () => ({type:'password',password:'test-only'})},
    {get:async h=>keys.get(h.address)??'',save:async (h,k)=>{keys.set(h.address,k);}},()=> 'session');
  return {session,events,starts,writes,keys,transport};
}
async function until(predicate:()=>boolean) {const end=Date.now()+2000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate());}

test('確認指紋後才連線、輸入與中斷；狀態不含密碼',async()=>{
  const {session,events,starts,writes,keys}=fixture();
  try {
    await session.connect(host);
    events.push({type:'hostKey',key:'test-key',fingerprint:'SHA256:test',algorithm:'ssh-ed25519'});
    await until(()=>session.getSnapshot().status==='trust');
    assert.equal(writes.length,0);
    await session.acceptHostKey();
    await until(()=>session.getSnapshot().status==='connected');
    assert.equal(keys.get(host.address),'test-key');
    await session.send('pwd\r');assert.deepEqual(writes,['pwd\r']);
    assert.equal(JSON.stringify(session.getSnapshot()).includes('test-only'),false);
    await session.connect({...host,id:'other'});assert.equal(starts.length,1);
    await session.disconnect();assert.equal(session.getSnapshot().status,'closed');
    await session.send('no');assert.deepEqual(writes,['pwd\r']);
  } finally {await session.disconnect();}
});

test('讀取憑證期間取消，不得稍後偷偷建立連線',async()=>{
  const {transport,starts}=fixture();
  let resolve!: (value:{type:'password';password:string})=>void;
  const session=new TerminalSession(transport,{updatePrivateKeyPassphrase:async()=>{},getCredentials:()=>new Promise(done=>{resolve=done;})},{get:async()=>'',save:async()=>{}},()=> 'cancelled');
  const connecting=session.connect(host);const closing=session.disconnect();
  resolve({type:'password',password:'late-secret'});
  await Promise.all([connecting,closing]);
  assert.equal(starts.length,0);assert.equal(session.getSnapshot().status,'closed');
});

test('信任儲存失敗會中斷，不繼續驗證；可重試其他主機',async()=>{
  const {transport,events}=fixture();let trusts=0;let disconnects=0;
  transport.trust=async()=>{trusts++;};transport.disconnect=async()=>{disconnects++;};
  const session=new TerminalSession(transport,{updatePrivateKeyPassphrase:async()=>{},getCredentials:async()=>({type:'password',password:'test-only'})},{get:async()=>'',save:async()=>{throw new Error('disk');}},()=> 'failure');
  await session.connect(host);events.push({type:'hostKey',key:'test',fingerprint:'SHA256:test',algorithm:'ssh-ed25519'});
  await until(()=>session.getSnapshot().status==='trust');await session.acceptHostKey();
  assert.equal(trusts,0);assert.equal(disconnects,1);assert.equal(session.getSnapshot().status,'error');
});

test('已知金鑰傳給原生驗證，變更錯誤明確顯示且不覆寫信任',async()=>{
  const {session,events,starts,keys}=fixture();keys.set(host.address,'pinned-key');
  await session.connect(host);assert.equal(starts[0].expectedKey,'pinned-key');
  events.push({type:'error',code:'host_key_changed'});await until(()=>session.getSnapshot().status==='error');
  assert.match(session.getSnapshot().message,/金鑰已變更/);assert.equal(keys.get(host.address),'pinned-key');
});

test('缺少憑證明確阻擋，不建立假連線',async()=>{
  for(const credential of [null]){
    const {transport,starts}=fixture();const session=new TerminalSession(transport,{updatePrivateKeyPassphrase:async()=>{},getCredentials:async()=>credential},{get:async()=>'',save:async()=>{}},()=> 'blocked');
    await session.connect(host);assert.equal(starts.length,0);assert.equal(session.getSnapshot().status,'error');
  }
});

test('舊連線輪詢失敗的延遲清理，不覆蓋新連線狀態',async()=>{
  const {transport}=fixture();
  let releaseCleanup!:()=>void;
  let cleanupStarted=false;let firstPoll=true;let serial=0;
  transport.poll=async()=>{if(firstPoll){firstPoll=false;throw new Error('old failure');}return [];};
  transport.disconnect=async()=>{if(!cleanupStarted){cleanupStarted=true;await new Promise<void>(resolve=>{releaseCleanup=resolve;});}};
  const session=new TerminalSession(transport,{updatePrivateKeyPassphrase:async()=>{},getCredentials:async()=>({type:'password',password:'test-only'})},{get:async()=>'',save:async()=>{}},()=>String(++serial));
  await session.connect(host);await until(()=>cleanupStarted);
  await session.disconnect();await session.connect({...host,id:'second'});
  releaseCleanup();await new Promise(resolve=>setTimeout(resolve,20));
  try {assert.equal(session.getSnapshot().host?.id,'second');assert.equal(session.getSnapshot().status,'connecting');}
  finally{await session.disconnect();}
});

test('私鑰與密語只交給 SSH 邊界，不進入終端狀態或輸出',async()=>{
  const {transport,starts}=fixture();
  const credentials={type:'privateKey' as const,privateKey:'test-private-key',passphrase:'test-passphrase'};
  const session=new TerminalSession(transport,{updatePrivateKeyPassphrase:async()=>{},getCredentials:async()=>credentials},{get:async()=>'',save:async()=>{}},()=> 'key');
  try{
    await session.connect({...host,authType:'privateKey'});
    assert.equal(starts.length,1);
    assert.deepEqual(starts[0].credentials,credentials);
    assert.equal(JSON.stringify([session.getSnapshot(),session.getOutput()]).includes('test-passphrase'),false);
    assert.equal(JSON.stringify([session.getSnapshot(),session.getOutput()]).includes('test-private-key'),false);
  } finally{await session.disconnect();}
});

test('私鑰密語保存失敗不重新連線，錯誤不包含密語',async()=>{
  const {transport,events,starts}=fixture();
  const session=new TerminalSession(transport,{getCredentials:async()=>({type:'privateKey',privateKey:'test-key',passphrase:''}),updatePrivateKeyPassphrase:async()=>{throw new Error('test-secret');}},{get:async()=>'',save:async()=>{}},()=> 'save-failure');
  await session.connect({...host,authType:'privateKey'});
  events.push({type:'error',code:'private_key_passphrase_required'});await until(()=>session.getSnapshot().status==='error');
  assert.equal(await session.retryWithPassphrase('test-secret'),false);
  assert.equal(starts.length,1);assert.equal(session.getSnapshot().message,'密語未保存，請重試。');
  assert.equal(JSON.stringify(session.getSnapshot()).includes('test-secret'),false);
});
