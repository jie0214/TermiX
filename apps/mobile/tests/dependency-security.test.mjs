import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const locations = name => Object.keys(lock.packages).filter(path => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`);
const depthError = error => error instanceof RangeError && error.message === 'TermiX: braces nesting exceeds 64 levels';

for (const location of locations('braces')) {
  const braces = require(resolve(root, location));
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    test(`${location} ${method} 拒絕過深括號與大括號`, () => {
      for (const [open, close] of [['{', '}'], ['(', ')'], ['{(', ')}']]) {
        const count = Math.floor(3500 / open.length);
        const input = open.repeat(count) + 'a' + close.repeat(count);
        assert.throws(() => braces[method](input), depthError);
        assert.throws(() => braces[method](input, { maxDepth: Infinity }), depthError);
      }
    });
  }
  for (const method of ['compile', 'expand', 'stringify']) {
    test(`${location} ${method} 直接傳入深層 AST 仍受保護`, () => {
      let ast = { type: 'text', value: 'a' };
      for (let depth = 0; depth < 3500; depth++) ast = { type: 'root', nodes: [ast] };
      assert.throws(() => braces[method](ast), depthError);
    });
  }
  test(`${location} 保留正常 glob、範圍及跳脫字元`, () => {
    assert.deepEqual(braces.expand('a{1..3}b{c,d}'), ['a1bc', 'a1bd', 'a2bc', 'a2bd', 'a3bc', 'a3bd']);
    assert.deepEqual(braces('{a,b{1..2}}'), ['(a|b(1|2))']);
    assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
    assert.doesNotThrow(() => braces.compile('{'.repeat(32) + 'a,b' + '}'.repeat(32)));
    assert.doesNotThrow(() => braces.compile('\\{'.repeat(100)));
  });
}

for (const location of locations('node-forge')) {
  const forge = require(resolve(root, location));
  // 每次測試產生臨時金鑰，不將私鑰或憑證寫入專案。
  const pair = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const privateKey = forge.pki.privateKeyFromPem(pair.privateKey.export({ type: 'pkcs1', format: 'pem' }));
  const publicKey = forge.pki.publicKeyFromPem(pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const { asn1 } = forge;
  const node = (type, constructed, value) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  const digest = forge.md.sha256.create().update('TermiX 安全回歸測試').digest().getBytes();
  const signStructure = algorithm => privateKey.sign(
    asn1.toDer(node(asn1.Type.SEQUENCE, true, [
      node(asn1.Type.SEQUENCE, true, algorithm),
      node(asn1.Type.OCTETSTRING, false, digest),
    ])).getBytes(), 'NONE');
  const oid = () => node(asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes());
  const nullNode = () => node(asn1.Type.NULL, false, '');

  test(`${location} 拒絕 DigestAlgorithm 多餘元素`, () => {
    for (const algorithm of [
      [oid(), nullNode(), node(asn1.Type.OCTETSTRING, false, 'garbage')],
      [oid(), node(asn1.Type.OCTETSTRING, false, 'garbage')],
      [oid(), nullNode(), nullNode()],
    ]) {
      const signature = signStructure(algorithm);
      assert.throws(() => publicKey.verify(digest, signature), /DigestInfo/);
    }
  });
  test(`${location} 正常 SHA-256 簽章及可選 NULL 仍有效`, () => {
    for (const algorithm of [[oid()], [oid(), nullNode()]]) {
      assert.equal(publicKey.verify(digest, signStructure(algorithm)), true);
    }
    const md = forge.md.sha256.create().update('正常訊息');
    const signature = privateKey.sign(md);
    assert.equal(publicKey.verify(md.digest().getBytes(), signature), true);
    assert.equal(publicKey.verify(digest, signature), false);
  });
}
