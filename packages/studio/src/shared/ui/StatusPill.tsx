interface StatusPillProps {
  children: string;
  tone?: 'accent' | 'danger' | 'muted' | 'success' | 'warning';
}

export function StatusPill({ children, tone = 'muted' }: StatusPillProps) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
