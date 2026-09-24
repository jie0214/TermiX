import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const term = new Terminal({ fontSize: 13, fontFamily: 'Menlo, monospace', scrollback: 1000,
  disableStdin: true, cursorBlink: false, theme: { background: '#142033', foreground: '#e5edf7' } });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('terminal'));
const post = message => window.ReactNativeWebView.postMessage(JSON.stringify(message));
// 不允許遠端透過 OSC 52 讀寫剪貼簿。
term.parser.registerOscHandler(52, () => true);
term.onData(data => post({ type: 'input', data }));
window.termixWrite = data => term.write(Uint8Array.from(atob(data), char => char.charCodeAt(0)), () => post({ type: 'written' }));
// 更新顏色不重建終端，保留 scrollback、選取與輸入狀態。
window.termixTheme = theme => {
  term.options.theme = theme;
  for (const element of [document.documentElement, document.body, document.getElementById('terminal')]) element.style.backgroundColor = theme.background;
};
let previous = '';
const resize = () => {
  fit.fit();
  const current = `${term.cols}:${term.rows}`;
  if (current !== previous) { previous = current; post({ type: 'resize', cols: term.cols, rows: term.rows }); }
};
new ResizeObserver(resize).observe(document.getElementById('terminal'));
requestAnimationFrame(() => { resize(); post({ type: 'ready' }); });

// xterm 的捲動區使用自訂 scrollbar，手機手勢需轉成終端列位移。
const surface = term.element;
let gesture;
surface.addEventListener('touchstart', event => {
  gesture = event.touches.length === 1 ? {
    id: event.touches[0].identifier, startY: event.touches[0].clientY,
    lastY: event.touches[0].clientY, remainder: 0, moved: false,
  } : undefined;
}, { passive: true });
surface.addEventListener('touchmove', event => {
  if (!gesture || event.touches.length !== 1) { gesture = undefined; return; }
  const touch = event.touches[0];
  if (touch.identifier !== gesture.id) return;
  if (!gesture.moved && Math.abs(touch.clientY - gesture.startY) < 5) return;
  gesture.moved = true;
  event.preventDefault();
  const lineHeight = surface.querySelector('.xterm-screen').getBoundingClientRect().height / term.rows;
  if (lineHeight > 0) {
    gesture.remainder += (gesture.lastY - touch.clientY) / lineHeight;
    const lines = Math.trunc(gesture.remainder);
    if (lines) { term.scrollLines(lines); gesture.remainder -= lines; }
  }
  gesture.lastY = touch.clientY;
}, { passive: false });
surface.addEventListener('touchend', () => {
  if (gesture && !gesture.moved) post({ type: 'tap' });
  gesture = undefined;
});
surface.addEventListener('touchcancel', () => { gesture = undefined; });
