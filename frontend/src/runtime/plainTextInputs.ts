// 只調整瀏覽器輸入輔助設定，不改寫文字、游標或輸入法組字事件。
export function installPlainTextInputs(doc: Document = document): () => void {
  const selector = 'input, textarea';
  const configure = (element: Element) => {
    element.setAttribute('autocomplete', 'off');
    element.setAttribute('autocorrect', 'off');
    element.setAttribute('autocapitalize', 'off');
    element.setAttribute('spellcheck', 'false');
    element.setAttribute('writingsuggestions', 'false');
  };
  const scan = (root: Element) => {
    if (root.matches(selector)) configure(root);
    root.querySelectorAll(selector).forEach(configure);
  };
  scan(doc.documentElement);
  const Observer = doc.defaultView!.MutationObserver;
  const observer = new Observer(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) scan(node as Element);
      }
    }
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  // 同步建立後立即聚焦的欄位，在 observer 回呼前也先套用。
  const onFocus = (event: Event) => {
    const element = event.target as Element | null;
    if (element?.matches?.(selector)) configure(element);
  };
  doc.addEventListener('focus', onFocus, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener('focus', onFocus, true);
  };
}
