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
  readonly commands: readonly { readonly id: string; readonly executable: string; readonly argv: readonly string[]; readonly cwd: string }[];
  readonly identity: VerificationIdentity;
  readonly manifestDigest: string;
  readonly mode: 'full' | 'scoped';
};

export function buildVerificationPlan(input: { readonly changedFiles: readonly string[]; readonly identity: VerificationIdentity }): VerificationPlan;
export function receiptIsCurrent(receipt: unknown, identity: VerificationIdentity): boolean;
export function validateReceipt(receipt: unknown): { readonly valid: boolean; readonly reason?: string };
