import type { ReleaseIntentRecord } from './release-intents.mjs';

export type ReleaseReadinessCheck = {
  detail: string;
  label: string;
  pass: boolean;
};

export type ReleaseReadinessDependencies = {
  workspacePackageManifests?: () => Array<{
    manifest: Record<string, unknown> & { name: string };
    packageJsonPath: string;
  }>;
  isPublishedVersion?: (packageName: string, version: string) => boolean;
  isReleaseTagExisting?: (tag: string) => boolean;
  hasReleaseNotesForPackage?: (changelog: string, packageName: string, version: string) => boolean;
  run?: (command: string, args: string[]) => void;
  read?: (relativePath: string) => string;
  existsSync?: (targetPath: string) => boolean;
  workspacePackageNames?: () => string[];
  mkdirSync?: (targetPath: string, options: { recursive: boolean }) => void;
  readFileSync?: (targetPath: string, encoding: string) => string;
  writeFileSync?: (targetPath: string, content: string, encoding: string) => void;
};

export type ReleaseReadinessResult = {
  checks: ReleaseReadinessCheck[];
  writeDrafts: boolean;
  writeSummary: boolean;
};

export function runReleaseReadinessVerification(
  options?: {
    changedPackages?: string[];
    distTag?: string;
    releaseIntentFile?: string;
    releaseIntentRecords?: ReleaseIntentRecord[];
    summaryOutputDirectory?: string;
    targetPackage?: string;
    targetVersion?: string;
    writeDrafts?: boolean;
    writeSummary?: boolean;
  },
  dependencies?: ReleaseReadinessDependencies,
): ReleaseReadinessResult;
