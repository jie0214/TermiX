import { t } from '../../i18n/index.ts';

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({
  label = t('misc.loading.workspace'),
}: LoadingStateProps) {
  return (
    <div
      className="react-loading-state no-drag"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="react-loading-state__indicator" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
