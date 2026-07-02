// 全域捲軸自動顯示/隱藏：
//  - 使用者捲動任一可捲動元素時顯示捲軸；
//  - 滑鼠移動到捲軸溝槽（元素右緣/下緣附近）時顯示；
//  - 距最後一次動作閒置 2 秒後隱藏。
// 以 document 事件委派實作，對專案任何可捲動元素自動生效，無需逐一綁定。
// 顯示狀態一律透過 .is-scrolling class 呈現（樣式見 style.css 全域區塊）。
// 程式性還原 scrollTop（如列表輪詢刷新）請包在 suppressScrollbarAutohide() 內，
// 避免非使用者捲動誤觸顯示。

const HIDE_DELAY = 2000;
// 判定「滑鼠位於捲軸上」的溝槽寬度（略大於 CSS 的 8px 捲軸，給一點容差）。
const GUTTER = 14;

interface AutohideElement extends HTMLElement {
  _sbHideTimer?: ReturnType<typeof setTimeout>;
}

let suppressed = false;

/** 在 run() 期間抑制捲軸自動顯示，用於程式性捲動（非使用者操作）。 */
export function suppressScrollbarAutohide<T>(run: () => T): T {
  suppressed = true;
  try {
    return run();
  } finally {
    // scroll 事件於下一 frame 才派發，於下一輪才解除，確保程式捲動造成的 scroll 已被略過。
    requestAnimationFrame(() => {
      suppressed = false;
    });
  }
}

function reveal(el: AutohideElement): void {
  el.classList.add('is-scrolling');
  if (el._sbHideTimer !== undefined) {
    clearTimeout(el._sbHideTimer);
  }
  el._sbHideTimer = setTimeout(() => {
    el.classList.remove('is-scrolling');
    el._sbHideTimer = undefined;
  }, HIDE_DELAY);
}

function handleScroll(event: Event): void {
  if (suppressed) {
    return;
  }
  const el = event.target;
  if (el instanceof HTMLElement) {
    reveal(el);
  }
}

/** 滑鼠是否位於此元素實際會出現捲軸的溝槽（右緣為垂直捲軸、下緣為水平捲軸）。 */
function nearScrollbar(el: HTMLElement, x: number, y: number): boolean {
  const rect = el.getBoundingClientRect();
  const nearRight =
    x <= rect.right && rect.right - x <= GUTTER && y >= rect.top && y <= rect.bottom;
  const nearBottom =
    y <= rect.bottom && rect.bottom - y <= GUTTER && x >= rect.left && x <= rect.right;
  if (!nearRight && !nearBottom) {
    return false;
  }
  const style = getComputedStyle(el);
  if (
    nearRight &&
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    el.scrollHeight > el.clientHeight
  ) {
    return true;
  }
  if (
    nearBottom &&
    (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
    el.scrollWidth > el.clientWidth
  ) {
    return true;
  }
  return false;
}

let rafPending = false;
let pointerX = 0;
let pointerY = 0;
let pointerTarget: Element | null = null;

function processPointer(): void {
  rafPending = false;
  // 由內層目標往上找到第一個「滑鼠正位於其捲軸溝槽」的可捲動祖先。
  let el: Element | null = pointerTarget;
  while (el instanceof HTMLElement) {
    if (nearScrollbar(el, pointerX, pointerY)) {
      reveal(el);
      return;
    }
    el = el.parentElement;
  }
}

function handleMouseMove(event: MouseEvent): void {
  pointerX = event.clientX;
  pointerY = event.clientY;
  pointerTarget = event.target instanceof Element ? event.target : null;
  if (rafPending) {
    return;
  }
  // 以 rAF 節流，避免每次 mousemove 都走訪祖先鏈量測版面。
  rafPending = true;
  requestAnimationFrame(processPointer);
}

export function installScrollbarAutohide(): () => void {
  // scroll 不會冒泡，需以 capture 於 document 攔截。
  document.addEventListener('scroll', handleScroll, true);
  document.addEventListener('mousemove', handleMouseMove, { passive: true });

  return () => {
    document.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('mousemove', handleMouseMove);
  };
}
