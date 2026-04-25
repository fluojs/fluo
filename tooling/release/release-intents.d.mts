export type WorkspacePackageManifestRecord = {
  manifest: Record<string, unknown> & {
    name: string;
    private?: boolean;
    publishConfig?: {
      access?: string;
    };
  };
  packageJsonPath: string;
};

export type ReleaseIntentPackageEntry = {
  breaking?: boolean;
  disposition: 'release' | 'no-release' | 'downstream-evaluate';
  migrationNote?: string;
  package: string;
  rationale: string;
  semver: 'patch' | 'minor' | 'major' | 'none';
  summary: string;
};

export type ReleaseIntentRecord = {
  packages: ReleaseIntentPackageEntry[];
  version: string;
};

export type ReleaseIntentValidationDependencies = {
  packageManifests?: WorkspacePackageManifestRecord[];
  publicPackageNames?: string[];
  repoRoot?: string;
};

export const firstEnforcedReleaseIntentVersion: string;
export const releaseIntentDispositions: ReadonlyArray<ReleaseIntentPackageEntry['disposition']>;
export const releaseIntentSemverIntents: ReadonlyArray<ReleaseIntentPackageEntry['semver']>;

export function compareVersions(left: string, right: string): number;
export function requiresReleaseIntentRecords(version: string): boolean;
export function workspacePackageManifests(rootDirectory?: string): WorkspacePackageManifestRecord[];
export function publicWorkspacePackageNames(packageManifests: WorkspacePackageManifestRecord[]): string[];
export function validateReleaseIntentRecord(
  record: unknown,
  dependencies?: ReleaseIntentValidationDependencies,
): ReleaseIntentRecord;
export function validateReleaseIntentRecords(
  records: unknown,
  options: ReleaseIntentValidationDependencies & { candidateVersion: string },
): ReleaseIntentRecord[];
