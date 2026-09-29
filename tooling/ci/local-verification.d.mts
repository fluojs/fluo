export type VerificationIdentity = {
  readonly baseRef: string;
  readonly baseSha: string;
  readonly changedFilesDigest: string;
  readonly clean: boolean;
  readonly diffDigest: string;
  readonly headSha: string;
  readonly mergeBase: string;
  readonly root: string;
  readonly treeSha: string;
  readonly worktreeStatusDigest: string;
};

export type VerificationCommand = {
  readonly executable: 'pnpm' | 'node' | 'bun' | 'deno';
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly runtimeVersion?: string;
  readonly when?: string;
};

export type VerificationTask = {
  readonly id: string;
  readonly runtime: 'primary' | 'compat24' | 'compat26' | 'runtimeFloor';
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly commands: readonly VerificationCommand[];
};

export type VerificationManifest = {
  readonly version: 2;
  readonly hostChecks: readonly (VerificationCommand & { readonly id: string })[];
  readonly tasks: readonly VerificationTask[];
  readonly companions: readonly { readonly commands: readonly VerificationCommand[]; readonly id: string; readonly when: string }[];
  readonly rules: readonly { readonly commands: readonly VerificationCommand[]; readonly prefix: string }[];
  readonly scope: { readonly fullPrefixes: readonly string[]; readonly fullPaths: readonly string[] };
};

export type VerificationPlan = {
  readonly version: 2;
  readonly hostChecks: readonly (VerificationCommand & { readonly id: string })[];
  readonly profile: 'pr' | 'extended';
  readonly changedFiles: readonly string[];
  readonly cleanDist: boolean;
  readonly companionChecks: readonly string[];
  readonly capabilityTasks: Readonly<Record<string, readonly string[]>>;
  readonly environment: {
    readonly lock: Readonly<Record<string, unknown>>;
    readonly lockDigest: string;
    readonly imageKey: string;
  };
  readonly identity: VerificationIdentity;
  readonly source: { readonly headSha: string; readonly treeSha: string; readonly baseSha: string };
  readonly manifestDigest: string;
  readonly semanticDigest: string;
  readonly mode: 'full' | 'scoped';
  readonly notApplicableCapabilities: Readonly<Record<string, string>>;
  readonly tasks: readonly VerificationTask[];
};

export type VerificationReceiptEvidence = {
  readonly receiptPath: string;
  readonly receiptSha256: string;
  readonly worktree: string;
};

export function digest(value: string | Buffer): string;
export function semanticPlanDigest(plan: VerificationPlan): string;
export function manifestPath(root: string): string;
export function readVerificationManifest(path?: URL | string): VerificationManifest;
export function buildVerificationPlan(input: {
  readonly changedFiles: readonly string[];
  readonly identity: VerificationIdentity;
  readonly manifest?: VerificationManifest;
  readonly profile?: 'pr' | 'extended';
  readonly lock?: Readonly<Record<string, unknown>>;
}): VerificationPlan;
export function verificationModeForChanges(changedFiles: readonly string[], manifest?: VerificationManifest): 'full' | 'scoped';
export function receiptIsCurrent(receipt: unknown, identity: VerificationIdentity): boolean;
export function receiptMatchesPlan(receipt: unknown, identity: VerificationIdentity, plan: VerificationPlan): boolean;
export function validateReceiptEvidence(receipt: unknown, evidence: VerificationReceiptEvidence): { readonly valid: boolean; readonly reason?: string };
export function validateReceipt(receipt: unknown): { readonly valid: boolean; readonly reason?: string };
