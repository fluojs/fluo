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
};

export function runReleaseReadinessVerification(
  options?: {
    distTag?: string;
    targetPackage?: string;
    targetVersion?: string;
    writeDrafts?: boolean;
  },
  dependencies?: ReleaseReadinessDependencies,
): ReleaseReadinessResult;
