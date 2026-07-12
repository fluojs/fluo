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

export type VersionPackagesDependencies = {
  readonly existsSync?: (targetPath: string) => boolean;
  readonly readFileSync?: (targetPath: string, encoding: 'utf8') => string;
  readonly runChangesetsVersion?: () => void;
  readonly workspacePackageManifests?: () => readonly WorkspacePackageManifestRecord[];
  readonly writeFileSync?: (targetPath: string, content: string, encoding: 'utf8') => void;
};

export type VersionPackagesResult = {
  readonly normalizedChangelogPaths: readonly string[];
};

export function normalizePackageChangelog(changelog: string): string;
export function runVersionPackages(dependencies?: VersionPackagesDependencies): VersionPackagesResult;
export function main(): void;
