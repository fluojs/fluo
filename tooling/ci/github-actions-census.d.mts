export function parseBounds(since: string, until: string): { since: string; until: string };
export function classifyAttempt(attempt: unknown): { kind: string; failedJobs: readonly unknown[] };
