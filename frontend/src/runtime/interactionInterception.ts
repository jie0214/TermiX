interface TermixAppElement extends Element {
  closeWorkspace(workspaceId: string): void;
}

interface TerminalPageElement extends Element {
  closePane(sessionKey: string): void;
}

function handleInteractionInterception(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const closeTabButton = target.closest('.close-tab');
  if (closeTabButton) {
    event.stopPropagation();
    event.preventDefault();
    const workspaceId = closeTabButton.getAttribute('data-workspace-id');
    const app = document.querySelector<TermixAppElement>('termix-app');
    if (workspaceId && app) {
      app.closeWorkspace(workspaceId);
    }
    return;
  }

  const closePaneButton = target.closest('.close-pane');
  if (closePaneButton) {
    event.stopPropagation();
    event.preventDefault();
    const sessionKey = closePaneButton.getAttribute('data-session-key');
    const terminalPage =
      document.querySelector<TerminalPageElement>('terminal-page');
    if (sessionKey && terminalPage) {
      terminalPage.closePane(sessionKey);
    }
    return;
  }

  const input = target.closest<HTMLInputElement | HTMLTextAreaElement>(
    'input, textarea',
  );
  if (input && !input.classList.contains('xterm-helper-textarea')) {
    event.stopPropagation();
    if (document.activeElement !== input) {
      input.focus();
    }
  }
}

export function installInteractionInterception(): () => void {
  document.addEventListener('mousedown', handleInteractionInterception, true);
  document.addEventListener('pointerdown', handleInteractionInterception, true);

  return () => {
    document.removeEventListener(
      'mousedown',
      handleInteractionInterception,
      true,
    );
    document.removeEventListener(
      'pointerdown',
      handleInteractionInterception,
      true,
    );
  };
}

