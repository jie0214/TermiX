export function setupDropdowns(root) {
  // 每次重繪先解除上輪監聽，避免文件事件隨搜尋與切換累積。
  root.dropdownAbortController?.abort();
  root.dropdownAbortController = new AbortController();
  const dropdownOptions = { signal: root.dropdownAbortController.signal };
  const triggers = [...root.querySelectorAll('.termix-dropdown-trigger')].filter(trigger => {
    let owner = trigger.parentElement;
    while (owner && !owner.localName.includes('-')) owner = owner.parentElement;
    return owner === root;
  });
  const closeDropdowns = (except = null) => {
    triggers.forEach(trigger => {
      if (trigger === except) return;
      trigger.nextElementSibling?.classList.remove('show');
      trigger.setAttribute('aria-expanded', 'false');
    });
  };
  triggers.forEach(trigger => {
    const menu = trigger.nextElementSibling;
    if (!menu?.classList.contains('termix-dropdown-menu')) return;
    trigger.setAttribute('aria-expanded', 'false');
    const items = () => [...menu.querySelectorAll('button:not(:disabled)')];
    const open = () => {
      closeDropdowns(trigger);
      menu.classList.add('show');
      trigger.setAttribute('aria-expanded', 'true');
    };
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      if (menu.classList.contains('show')) closeDropdowns();
      else open();
    }, dropdownOptions);
    trigger.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      open();
      (e.key === 'ArrowDown' ? items()[0] : items().at(-1))?.focus();
    }, dropdownOptions);
    menu.addEventListener('keydown', e => {
      const buttons = items();
      const index = buttons.indexOf(document.activeElement);
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }, dropdownOptions);
    menu.addEventListener('click', e => {
      if (!e.target.closest('button')) return;
      closeDropdowns();
      // 表單開啟時保留表單焦點；重繪後把焦點交回新的選單入口。
      const triggerId = trigger.id;
      queueMicrotask(() => {
        if (document.activeElement === document.body || menu.contains(document.activeElement)) {
          (triggerId ? root.querySelector(`#${triggerId}`) : trigger.isConnected ? trigger : null)?.focus();
        }
      });
    }, { ...dropdownOptions, capture: true });
  });
  document.addEventListener('click', () => closeDropdowns(), dropdownOptions);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const trigger = triggers.find(item => item.getAttribute('aria-expanded') === 'true');
    if (!trigger) return;
    e.preventDefault();
    closeDropdowns();
    trigger.focus();
  }, dropdownOptions);
  document.addEventListener('focusin', e => {
    const owner = triggers.find(trigger => trigger.parentElement?.contains(e.target));
    closeDropdowns(owner);
  }, dropdownOptions);

}
