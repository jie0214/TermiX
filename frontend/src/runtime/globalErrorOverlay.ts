function valueToText(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  return String(value ?? 'No stack trace available');
}

function createTextElement(tagName: string, text: string): HTMLElement {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

export function showGlobalErrorOverlay(
  message: string,
  source = '',
  lineNumber = 0,
  columnNumber = 0,
  error?: unknown,
): void {
  const container = document.createElement('div');
  container.className = 'termix-global-error-overlay no-drag';

  const title = createTextElement(
    'h1',
    'TermiX 前端執行期致命錯誤（JavaScript Uncaught Exception）',
  );
  const summary = createTextElement(
    'div',
    `Error：${message}\nSource：${source}:${lineNumber}:${columnNumber}`,
  );
  const stackTitle = createTextElement('div', 'Stack Trace：');
  const stack = createTextElement('pre', valueToText(error));
  const closeButton = document.createElement('button');
  closeButton.textContent = '關閉此提示';
  closeButton.type = 'button';
  closeButton.addEventListener('click', () => container.remove());

  container.append(title, summary, stackTitle, stack, closeButton);
  document.body.appendChild(container);
}

export function installGlobalErrorHandlers(): () => void {
  const handleError = (event: ErrorEvent) => {
    showGlobalErrorOverlay(
      event.message,
      event.filename,
      event.lineno,
      event.colno,
      event.error,
    );
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const message =
      event.reason instanceof Error
        ? event.reason.message
        : String(event.reason ?? 'Unhandled promise rejection');
    showGlobalErrorOverlay(message, '', 0, 0, event.reason);
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
