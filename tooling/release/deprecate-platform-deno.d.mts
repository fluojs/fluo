export type DenoAdvisoryManifest = {
  readonly name: string;
  readonly version: string;
  readonly description: string;
};

export type DenoRegistry = {
  readonly 'dist-tags': { readonly latest: string };
  readonly versions: Readonly<Record<string, {
    readonly description?: string;
    readonly deprecated?: string;
  }>>;
};

export type DenoDeprecationDependencies = {
  readonly readRegistry?: () => Promise<DenoRegistry>;
  readonly checkMigration?: () => Promise<void>;
  readonly deprecate?: () => void | Promise<void>;
};

export const deprecationMessage: string;

export function runDenoDeprecation(
  manifest: DenoAdvisoryManifest,
  dependencies?: DenoDeprecationDependencies,
): Promise<
  | { readonly status: 'pending-advisory-release'; readonly version: string }
  | { readonly status: 'deprecated'; readonly version: string; readonly versions: number }
>;
