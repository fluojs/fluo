export function shouldForceFullVerificationByPath(changedFiles: readonly string[]): string | undefined;

export function shouldVerifyIsolatedHttpBenchmark(changedFiles: readonly string[]): boolean;

export function shouldVerifyReactAppBenchmark(changedFiles: readonly string[]): boolean;

export type VerificationSelection = {
  readonly mode: 'full' | 'scoped' | 'docs';
  readonly reason: string;
  readonly filters: readonly string[];
  readonly buildFilters: readonly string[];
  readonly packageNames: readonly string[];
  readonly packageDirectories: readonly string[];
  readonly buildDirectories: readonly string[];
  readonly graphDigest: string | null;
  readonly tasks: readonly string[];
  readonly toolingPaths: readonly string[];
  readonly typecheckNames: readonly string[];
};
export function resolveVerificationScope(changedFiles: readonly string[], options?: {
  readonly root?: string; readonly forceFull?: boolean;
  readonly scope?: import('./local-verification.mjs').VerificationManifest['scope'];
}): VerificationSelection;
export function fullVerificationRequested(env?: Readonly<Record<string, string | undefined>>): boolean;
export function isProsePath(path: string): boolean;
export function readWorkspaceGraph(root?: string): {
  readonly digest: string;
  readonly entries: readonly { readonly name: string; readonly directory: string;
    readonly manifest: { readonly scripts?: Readonly<Record<string, string>> };
    readonly dependencies: readonly string[] }[];
};
