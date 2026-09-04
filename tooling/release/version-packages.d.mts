export type WorkspacePackageManifestRecord = {
  readonly manifest: {
    readonly name: string;
    readonly private?: boolean;
    readonly publishConfig?: {
      readonly access?: string;
    };
  };
  readonly packageJsonPath: string;
};

export type ChangesetsVersionSpawnResult = {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error | undefined;
};

export type ChangesetsVersionDependencies = {
  readonly attempts?: number;
  readonly sleep?: (milliseconds: number) => void;
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly encoding: 'utf8' },
  ) => ChangesetsVersionSpawnResult;
  readonly writeOutput?: (stream: { readonly write: (chunk: string) => unknown }, chunk: string) => unknown;
};

export type VersionPackagesDependencies = {
  readonly existsSync?: (targetPath: string) => boolean;
  readonly readFileSync?: (targetPath: string, encoding: 'utf8') => string;
  readonly runChangesetsVersion?: (dependencies?: ChangesetsVersionDependencies) => void;
  readonly workspacePackageManifests?: () => readonly WorkspacePackageManifestRecord[];
  readonly writeFileSync?: (targetPath: string, content: string, encoding: 'utf8') => void;
};

export type VersionPackagesResult = {
  readonly normalizedChangelogPaths: readonly string[];
};

export function normalizePackageChangelog(changelog: string): string;
export function runChangesetsVersion(dependencies?: ChangesetsVersionDependencies): void;
export function runVersionPackages(dependencies?: VersionPackagesDependencies): VersionPackagesResult;
export function main(): void;
