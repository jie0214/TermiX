import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

import { DEFAULT_ROUTE_PATH } from '../../routing/routes';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('TermiX React 元件發生未處理錯誤：', error, errorInfo);
  }

  private returnToHosts = (): void => {
    this.setState({ error: null });
    window.location.replace(`#${DEFAULT_ROUTE_PATH}`);
  };

  private reloadApplication = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <main className="react-error-boundary no-drag" role="alert">
        <section className="react-error-boundary__panel">
          <p className="react-error-boundary__eyebrow">REACT RENDER ERROR</p>
          <h1>此畫面無法繼續顯示</h1>
          <p>
            React 元件發生未處理錯誤。終端連線或背景工作階段不會由此畫面自動關閉。
          </p>
          <details>
            <summary>查看錯誤內容</summary>
            <pre>{error.message || '未知的 React 執行期錯誤。'}</pre>
          </details>
          <div className="react-error-boundary__actions">
            <button type="button" onClick={this.reloadApplication}>
              重新載入應用程式
            </button>
            <button type="button" onClick={this.returnToHosts}>
              返回主機管理
            </button>
          </div>
        </section>
      </main>
    );
  }
}
