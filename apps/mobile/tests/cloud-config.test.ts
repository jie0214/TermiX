import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

for (const environment of ['Development', 'Production']) {
  test(`Expo 產生的 CloudKit 權限保留 ${environment} 與共用容器`, () => {
    const config = JSON.parse(execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
      env: { ...process.env, TERMIX_ICLOUD_CONTAINER: 'iCloud.test.termix', TERMIX_ICLOUD_ENVIRONMENT: environment },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
    const entitlements = config._internal.modResults.ios.entitlements;
    assert.equal(entitlements['com.apple.developer.icloud-container-environment'], environment);
    assert.deepEqual(entitlements['com.apple.developer.icloud-container-identifiers'], ['iCloud.test.termix']);
    assert.deepEqual(entitlements['com.apple.developer.icloud-services'], ['CloudKit']);
  });
}

test('Apple 正式建置缺少容器或不是 Production 時停止', () => {
  for (const [container, environment] of [['', 'Production'], ['iCloud.test.termix', 'Development']]) {
    assert.throws(() => execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
      env: { ...process.env, EXPO_NO_DOTENV: '1', TERMIX_APPLE_RELEASE: '1', TERMIX_ICLOUD_CONTAINER: container, TERMIX_ICLOUD_ENVIRONMENT: environment },
      stdio: 'pipe',
    }));
  }
});
