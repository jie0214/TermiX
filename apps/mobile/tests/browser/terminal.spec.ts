import { test, expect } from '@playwright/test';
import { terminalHtml } from '../../src/features/terminal/terminalHtml';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.setContent(terminalHtml.replace('<script>', '<script>window.ReactNativeWebView={postMessage:()=>{}};</script><script>'));
  await expect(page.locator('.xterm-rows > div').first()).toBeVisible();
  await page.evaluate(() => {
    const output = Array.from({ length: 150 }, (_, i) => `line-${String(i).padStart(3, '0')}\r\n`).join('') + 'latest-prompt$ ';
    (window as unknown as {termixWrite(s: string): void}).termixWrite(btoa(output));
  });
  await expect(page.locator('.xterm-rows')).toContainText('latest-prompt$');
});

test('終端最後一列在完整及鍵盤縮小後的畫面內', async ({ page }) => {
  for (const height of [500, 237, 163, 500]) {
    await page.setViewportSize({ width: 390, height });
    await expect.poll(async () => page.locator('.xterm-screen').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(height);
    await expect(page.locator('.xterm-rows')).toContainText('latest-prompt$');
  }
});

test('單指上下拖曳能閱讀歷史並返回最新輸出', async ({ page }) => {
  const before = await page.locator('.xterm-rows').innerText();
  const swipe = async (from: number, to: number) => page.locator('.xterm-screen').evaluate((el, {from, to}) => {
    const event = (type: string, y: number) => {
      const touch = { identifier: 1, target: el, clientX: 100, clientY: y };
      const gesture = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(gesture, { touches: { value: type === 'touchend' ? [] : [touch] }, changedTouches: { value: [touch] } });
      el.dispatchEvent(gesture);
    };
    event('touchstart', from); event('touchmove', to); event('touchend', to);
  }, {from, to});
  await swipe(100, 400);
  await expect.poll(() => page.locator('.xterm-rows').innerText()).not.toBe(before);
  await expect(page.locator('.xterm-rows')).not.toContainText('latest-prompt$');
  await swipe(400, 100);
  await expect(page.locator('.xterm-rows')).toContainText('latest-prompt$');
});
