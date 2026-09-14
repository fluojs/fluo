export type GithubCensusJob = {
  readonly completed_at?: string | null;
  readonly conclusion?: string | null;
  readonly html_url?: string | null;
  readonly id: number;
  readonly name?: string;
  readonly steps?: readonly unknown[];
};

export type GithubCensusAttempt = {
  readonly conclusion?: string | null;
  readonly created_at: string;
  readonly event?: string;
  readonly jobs: readonly GithubCensusJob[];
  readonly run_attempt: number;
  readonly run_id: number;
  readonly status?: string;
};

export function collectGithubActionsCensus(input: {
  readonly execFileSync?: (
    command: string,
    args: readonly string[],
    options: { readonly encoding: 'utf8' },
  ) => string;
  readonly observedAt?: () => string;
  readonly owner: string;
  readonly repo: string;
  readonly since: string;
  readonly until: string;
  readonly workflow: string;
}): {
  readonly attempts: readonly GithubCensusAttempt[];
  readonly limits: readonly string[];
  readonly observed_at: string;
  readonly pagination: { readonly jobs: number; readonly runs: number };
  readonly workflow_runs: readonly unknown[];
};
