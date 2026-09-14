export type VerificationIdentity = {
  readonly baseRef: string;
  readonly baseSha: string;
  readonly changedFilesDigest: string;
  readonly diffDigest: string;
  readonly headSha: string;
  readonly mergeBase: string;
  readonly root: string;
  readonly treeSha: string;
};

export type VerificationPlan = {
  readonly cleanDist: boolean;
  readonly companionChecks: readonly string[];
  readonly commands: readonly { readonly id: string; readonly executable: string; readonly argv: readonly string[]; readonly cwd: string }[];
  readonly identity: VerificationIdentity;
  readonly manifestDigest: string;
  readonly mode: 'full' | 'scoped';
};

export type VerificationManifest = {
  readonly version: 1;
  readonly companions: readonly { readonly id: string; readonly when: string }[];
  readonly rules: readonly { readonly prefix: string; readonly argv: readonly string[] }[];
  readonly scope: { readonly fullPrefixes: readonly string[]; readonly fullPaths: readonly string[] };
};

export function readVerificationManifest(path?: URL | string): VerificationManifest;
export function buildVerificationPlan(input: {
  readonly changedFiles: readonly string[];
  readonly identity: VerificationIdentity;
  readonly manifest?: VerificationManifest;
}): VerificationPlan;
export function verificationModeForChanges(changedFiles: readonly string[], manifest?: VerificationManifest): 'full' | 'scoped';
export function receiptIsCurrent(receipt: unknown, identity: VerificationIdentity): boolean;
export function validateReceipt(receipt: unknown): { readonly valid: boolean; readonly reason?: string };
