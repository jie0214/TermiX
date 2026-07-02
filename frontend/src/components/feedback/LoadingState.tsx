interface LoadingStateProps {
  label?: string;
}

export function LoadingState({
  label = '正在載入 TermiX 工作區',
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
