export function parseBounds(since: string, until: string): { since: string; until: string };
export function parseCensusArgs(argv: readonly string[]): {
  readonly owner: string;
  readonly repo: string;
  readonly workflow: string;
  readonly since: string;
  readonly until: string;
  readonly input?: string;
};
export function classifyAttempt(attempt: unknown): { readonly kind: string; readonly failedJobs: readonly unknown[] };
export type CensusOccurrence = {
  readonly fingerprints: { readonly job: string; readonly steps: string };
  readonly job: { readonly id: number; readonly name: string; readonly conclusion: string };
  readonly run: { readonly id: number; readonly attempt: number };
  readonly urls: { readonly attempt: string; readonly job: string | null; readonly run: string | null };
};
export type CensusAttempt = {
  readonly attempt: { readonly run_attempt: number };
  readonly classification: { readonly kind: string; readonly failedJobs: readonly unknown[] };
  readonly jobs: readonly {
    readonly id: number;
    readonly name: string;
    readonly conclusion: string;
    readonly steps: readonly unknown[];
  }[];
  readonly run: { readonly id: number; readonly conclusion?: string };
};
export function buildCensus(input: {
  readonly input: unknown;
  readonly owner: string;
  readonly repo: string;
  readonly workflow: string;
  readonly since: string;
  readonly until: string;
}): {
  readonly attempts: readonly CensusAttempt[];
  readonly limits: readonly string[];
  readonly observedAt: string | null;
  readonly pagination: Readonly<Record<string, unknown>>;
  readonly scope: Readonly<Record<string, string>>;
  readonly summary: {
    readonly classificationCounts: Readonly<Record<string, number>>;
    readonly failureBearingAttempts: number;
    readonly signatures: readonly { readonly fingerprint: string; readonly occurrences: readonly CensusOccurrence[] }[];
    readonly derivedAggregateOccurrences: readonly CensusOccurrence[];
  };
};
