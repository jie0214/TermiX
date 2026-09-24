import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostRepository } from '../src/features/hosts/repository.ts';
import { memoryVault, passwordAuth, testPrivateKey } from './fixtures.ts';

test('新增主機後，重新建立儲存服務仍能讀取連線設定', async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); },
  };
  const hosts = new HostRepository(storage, () => 'host-1', memoryVault());
  await hosts.add({ name: ' Home lab ', address: ' 192.0.2.10 ', username: ' admin ', port: '22' }, passwordAuth);
  assert.deepEqual(await new HostRepository(storage, () => 'unused', memoryVault()).list(), [
    { id: 'host-1', name: 'Home lab', address: '192.0.2.10', username: 'admin', port: 22, authType: 'password', credentialRef: 'termix.ssh.host-1' },
  ]);
});

test('拒絕空白欄位、不合法位址與連接埠，且不保存無效主機', async () => {
  const data = new Map<string, string>();
  const hosts = new HostRepository({
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
  }, () => 'invalid', memoryVault());
  const valid = { name: '主機', address: 'example.com', username: 'admin', port: '22' };
  for (const change of [
    { name: ' ' }, { address: ' ' }, { address: 'https://example.com' },
    { address: 'server name' }, { username: ' ' }, { username: 'ad\nmin' },
    { port: '' }, { port: '0' }, { port: '65536' }, { port: '22.5' }, { port: '2e2' },
  ]) {
    await assert.rejects(hosts.add({ ...valid, ...change }, passwordAuth));
  }
  assert.deepEqual(await hosts.list(), []);
});

test('損毀或較新版本資料不可被新增操作覆蓋', async () => {
  for (const raw of ['{broken', '{"version":3,"hosts":[]}', '{"version":1,"hosts":[{}]}']) {
    let saved = raw;
    const hosts = new HostRepository({ getItem: async () => saved, setItem: async (_, value) => { saved = value; } }, () => 'host-1', memoryVault());
    await assert.rejects(hosts.list(), /無法讀取主機資料/);
    await assert.rejects(hosts.add({ name: '主機', address: 'example.com', username: 'admin', port: '22' }, passwordAuth));
    assert.equal(saved, raw);
  }
});

test('同時新增不遺失主機，儲存失敗後仍可重試', async () => {
  let saved: string | null = null;
  let fail = true;
  let id = 0;
  const hosts = new HostRepository({
    getItem: async () => saved,
    setItem: async (_, value) => {
      if (fail) throw new Error('儲存失敗');
      saved = value;
    },
  }, () => `host-${++id}`, memoryVault());
  const draft = { name: 'A', address: 'example.com', username: 'admin', port: '22' };
  await assert.rejects(hosts.add(draft, passwordAuth), /保存失敗/);
  assert.deepEqual(await hosts.list(), []);
  fail = false;
  await Promise.all([hosts.add(draft, passwordAuth), hosts.add({ ...draft, name: 'B' }, passwordAuth)]);
  assert.deepEqual((await hosts.list()).map(host => host.name), ['A', 'B']);
});

test('主機位址接受 hostname、IPv4 與 IPv6，拒絕夾帶連接埠或無效 IP', async () => {
  let raw: string | null = null;
  let id = 0;
  const hosts = new HostRepository({ getItem: async () => raw, setItem: async (_, value) => { raw = value; } }, () => String(++id), memoryVault());
  for (const address of ['example.com:2222', '999.1.1.1', '2001:::1', '-server', 'server..local', '[::1]:2222']) {
    await assert.rejects(hosts.add({ name: '主機', address, username: 'admin', port: '22' }, passwordAuth));
  }
  for (const address of ['server', 'my-server.example.com', '192.0.2.1', '::1', '2001:db8::1', '[2001:db8::2]']) {
    await hosts.add({ name: '主機', address, username: 'admin', port: '2222' }, passwordAuth);
  }
  assert.deepEqual((await hosts.list()).map(host => host.address), ['server', 'my-server.example.com', '192.0.2.1', '::1', '2001:db8::1', '2001:db8::2']);
});

test('密碼分離保存且重建服務後可取回，一般主機資料不含機密', async () => {
  let metadata: string | null = null;
  const secrets = new Map<string, string>();
  const storage = { getItem: async () => metadata, setItem: async (_: string, value: string) => { metadata = value; } };
  const vault = { get: async (key: string) => secrets.get(key) ?? null,
    set: async (key: string, value: string) => { secrets.set(key, value); },
    remove: async (key: string) => { secrets.delete(key); } };
  const repository = new HostRepository(storage, () => 'secure-host', vault);
  await repository.add({ name: '主機', address: '192.0.2.10', username: 'admin', port: '22' }, { type: 'password', password: 'test-only-password' });
  const restored = new HostRepository(storage, () => 'unused', vault);
  assert.equal((await restored.list())[0].authType, 'password');
  assert.deepEqual(await restored.getCredentials('secure-host'), { type: 'password', password: 'test-only-password' });
  assert.ok(!String(metadata).includes('test-only-password'));
  assert.ok(!JSON.stringify(await restored.list()).includes('test-only-password'));
});

test('舊版主機保留且標記尚未設定驗證方式', async () => {
  const raw = JSON.stringify({ version: 1, hosts: [{ id: 'old', name: '舊主機', address: '192.0.2.1', username: 'admin', port: 22 }] });
  const repository = new HostRepository({ getItem: async () => raw, setItem: async () => {} }, () => 'new', memoryVault());
  assert.equal((await repository.list())[0].authType, 'unconfigured');
  assert.equal(await repository.getCredentials('old'), null);
});

test('Keychain 寫入失敗不新增主機，主機資料保存失敗會清除已寫入憑證', async () => {
  const secrets = new Map<string, string>();
  let failSecret = true;
  const vault = {
    get: async (key: string) => secrets.get(key) ?? null,
    set: async (key: string, value: string) => { if (failSecret) throw new Error('vault'); secrets.set(key, value); },
    remove: async (key: string) => { secrets.delete(key); },
  };
  let metadata: string | null = null;
  let failMetadata = false;
  const repository = new HostRepository({ getItem: async () => metadata,
    setItem: async (_, value) => { if (failMetadata) throw new Error('disk'); metadata = value; } }, () => 'auth-failure', vault);
  const draft = { name: '主機', address: '192.0.2.1', username: 'admin', port: '22' };
  await assert.rejects(repository.add(draft, passwordAuth));
  assert.deepEqual(await repository.list(), []);
  failSecret = false;
  failMetadata = true;
  await assert.rejects(repository.add(draft, passwordAuth));
  assert.equal(secrets.size, 0);
  assert.deepEqual(await repository.list(), []);
});

test('私鑰與密語保留原值且不寫入一般資料，公鑰與空密碼不能保存', async () => {
  const { testPrivateKey } = await import('./fixtures.ts');
  let metadata: string | null = null;
  const vault = memoryVault();
  const storage = { getItem: async () => metadata, setItem: async (_: string, value: string) => { metadata = value; } };
  const repository = new HostRepository(storage, () => 'key-host', vault);
  const draft = { name: '主機', address: '192.0.2.1', username: 'admin', port: '22' };
  await assert.rejects(repository.add(draft, { type: 'password', password: '' }));
  await assert.rejects(repository.add(draft, { type: 'privateKey', privateKey: 'ssh-ed25519 AAAA public-key', passphrase: '' }));
  const credentials = { type: 'privateKey' as const, privateKey: testPrivateKey, passphrase: ' test-only-passphrase ' };
  await repository.add(draft, credentials);
  const restored = new HostRepository(storage, () => 'unused', vault);
  assert.deepEqual(await restored.getCredentials('key-host'), credentials);
  assert.ok(!String(metadata).includes('PRIVATE KEY'));
  assert.ok(!String(metadata).includes('test-only-passphrase'));
});

test('修正私鑰密語只更新安全儲存，重建服務後保留私鑰與新密語', async () => {
  const data = new Map<string,string>();
  const storage = {getItem:async (key:string)=>data.get(key)??null,setItem:async (key:string,value:string)=>{data.set(key,value);}};
  const vault = memoryVault();
  const repository = new HostRepository(storage,()=> 'passphrase-host',vault);
  const host = await repository.add({name:'key',address:'example.com',username:'test',port:'22'}, {type:'privateKey',privateKey:testPrivateKey,passphrase:'old-test-secret'});
  const metadata = [...data.entries()];
  await repository.updatePrivateKeyPassphrase(host.id,' 新的密語 ');
  const restored = await new HostRepository(storage,()=> 'unused',vault).getCredentials(host.id);
  assert.deepEqual(restored,{type:'privateKey',privateKey:testPrivateKey,passphrase:' 新的密語 '});
  assert.deepEqual([...data.entries()],metadata);
});
