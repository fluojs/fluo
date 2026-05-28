interface EmptyStateProps {
  action?: string;
  title: string;
}

/**
 * Provides Empty State behavior for the Studio devtool.
 */
export function EmptyState({ action, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {action ? <span>{action}</span> : null}
    </div>
  );
}
