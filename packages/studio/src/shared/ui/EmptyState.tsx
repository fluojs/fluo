interface EmptyStateProps {
  action?: string;
  title: string;
}

export function EmptyState({ action, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {action ? <span>{action}</span> : null}
    </div>
  );
}
