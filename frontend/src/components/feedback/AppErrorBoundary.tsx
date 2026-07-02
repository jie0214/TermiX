import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

import { DEFAULT_ROUTE_PATH } from '../../routing/routes';
import { t } from '../../i18n/index.ts';

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
          <p className="react-error-boundary__eyebrow">{t('misc.errorBoundary.eyebrow')}</p>
          <h1>{t('misc.errorBoundary.heading')}</h1>
          <p>
            {t('misc.errorBoundary.description')}
          </p>
          <details>
            <summary>{t('misc.errorBoundary.details')}</summary>
            <pre>{error.message || t('misc.errorBoundary.unknownError')}</pre>
          </details>
          <div className="react-error-boundary__actions">
            <button type="button" onClick={this.reloadApplication}>
              {t('misc.errorBoundary.reload')}
            </button>
            <button type="button" onClick={this.returnToHosts}>
              {t('misc.errorBoundary.backToHosts')}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
