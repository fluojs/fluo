interface StatusPillProps {
  children: string;
  tone?: 'accent' | 'danger' | 'muted' | 'success' | 'warning';
}

/**
 * Provides Status Pill behavior for the Studio devtool.
 */
export function StatusPill({ children, tone = 'muted' }: StatusPillProps) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
