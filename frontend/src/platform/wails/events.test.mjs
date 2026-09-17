import assert from 'node:assert/strict';
import test from 'node:test';

import { openBrowserURL } from './events.ts';

test('openBrowserURL 只允許 HTTP 與 HTTPS 外部連結', () => {
  const originalWindow = globalThis.window;
  const opened = [];
  globalThis.window = {
    runtime: {
      BrowserOpenURL: (url) => opened.push(url)
    }
  };

  try {
    openBrowserURL('https://github.com/jie0214/TermiX/releases');
    openBrowserURL('http://127.0.0.1:8080');
    for (const unsafeURL of [
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'file:///tmp/secret',
      'rustdesk://123456',
      'not-a-url'
    ]) {
      openBrowserURL(unsafeURL);
    }
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }

  assert.deepEqual(opened, [
    'https://github.com/jie0214/TermiX/releases',
    'http://127.0.0.1:8080'
  ]);
});
