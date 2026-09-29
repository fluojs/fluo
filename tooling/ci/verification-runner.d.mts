import type { VerificationPlan } from './local-verification.mjs';

export type VerificationTaskResult = {
  readonly version: 2;
  readonly taskId: string;
  readonly status: 'passed' | 'failed';
  readonly headSha: string;
  readonly treeSha: string;
  readonly planDigest: string;
  readonly imageKey: string;
  readonly imageId: string;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly commands: readonly {
    readonly command: VerificationPlan['tasks'][number]['commands'][number];
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly spawnError: string | null;
    readonly identityBefore: { readonly headSha: string; readonly treeSha: string; readonly statusDigest: string };
    readonly identityAfter: { readonly headSha: string; readonly treeSha: string; readonly statusDigest: string } | null;
  }[];
  readonly logs: readonly { readonly commandIndex: number; readonly path: string; readonly digest: string }[];
  readonly artifacts: readonly { readonly path: string; readonly digest: string; readonly size: number }[];
  readonly startedAt: string;
  readonly completedAt: string;
};

export function validatePlan(plan: VerificationPlan, catalogRoot?: string): VerificationPlan;
export function validateTaskResult(
  plan: VerificationPlan, task: VerificationPlan['tasks'][number],
  result: VerificationTaskResult, output: string, artifacts: string,
): VerificationTaskResult;
export function aggregateResults(
  plan: VerificationPlan, output: string, artifacts: string,
  jobResults?: Readonly<Record<string, { readonly result: string }>> | null,
  catalogRoot?: string,
): VerificationTaskResult[];
export function restoreBuildInputs(
  plan: VerificationPlan, task: VerificationPlan['tasks'][number], artifacts: string, root: string,
): void;
export function runTask(
  plan: VerificationPlan, taskId: string, output: string,
  artifacts: string, planPath: string, sourceRoot?: string,
): VerificationTaskResult;
export function main(argv?: readonly string[]): void;

export type VerificationHostResult = {
  readonly status: 'passed' | 'failed';
  readonly headSha: string;
  readonly treeSha: string;
  readonly planDigest: string;
  readonly commands: readonly {
    readonly command: VerificationPlan['hostChecks'][number];
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly spawnError: string | null;
  }[];
  readonly logs: readonly { readonly path: string; readonly digest: string }[];
};
export function runHostChecks(plan: VerificationPlan, output: string, sourceRoot?: string): VerificationHostResult;
export function validateHostChecks(plan: VerificationPlan, result: VerificationHostResult, output: string): VerificationHostResult;
