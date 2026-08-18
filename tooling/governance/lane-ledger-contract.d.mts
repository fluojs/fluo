type LaneLedgerContractValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly LaneLedgerContractValue[]
  | LaneLedgerContractObject;

interface LaneLedgerContractObject {
  readonly [key: string]: LaneLedgerContractValue;
}

type TerminalStatus =
  | 'done'
  | 'blocked-terminal'
  | 'needs-human-check-terminal'
  | 'blocked-budget-exhausted'
  | 'blocked-maintainer-decision'
  | 'blocked-child-contract-error'
  | 'blocked-ledger-conflict';

type ActiveStatus = 'queued' | 'running' | 'in_review' | 'merged';
type RootStatus = 'ready' | 'running' | TerminalStatus;
type ProgressStatus = ActiveStatus | TerminalStatus;
type RootMainSyncStatus = 'not-started' | 'done' | 'skipped-authority' | 'blocked-dirty';
type MergePolicy =
  | 'developer-final'
  | 'supervisor-auto'
  | 'supervisor-with-human-escalation'
  | 'supervisor-full-auto';

export const terminalStatuses: ReadonlySet<TerminalStatus>;
export const activeStatuses: ReadonlySet<ActiveStatus>;
export const rootStatuses: ReadonlySet<RootStatus>;
export const progressStatuses: ReadonlySet<ProgressStatus>;
export const rootMainSyncStatuses: ReadonlySet<RootMainSyncStatus>;
export const allowedMergePolicies: ReadonlySet<MergePolicy>;
export const primaryRepoRoot: string;

export function fail(path: string, message: string): never;
export function assert(condition: boolean, path: string, message: string): asserts condition;
export function isObject(
  value: LaneLedgerContractValue,
): value is LaneLedgerContractObject;
export function hasExactKeys(value: LaneLedgerContractObject, expectedKeys: readonly string[]): boolean;
export function isSha(value: LaneLedgerContractValue): value is string;
export function isPositiveInteger(value: LaneLedgerContractValue): value is number;
export function isNonEmptyString(value: LaneLedgerContractValue): value is string;
export function isSafeBranchName(value: LaneLedgerContractValue): value is string;
export function isMatchingWorktree(worktree: string, branch: string): boolean;
export function parsePullRequest(value: LaneLedgerContractValue): number | null;
export function registerPullRequest(
  assignments: Map<number, number>,
  value: LaneLedgerContractValue,
  issue: number,
  path: string,
): number;
