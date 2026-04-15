export type ReleaseReadinessCheck = {
  detail: string;
  label: string;
  pass: boolean;
};

export type ReleaseReadinessDependencies = {
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
  options?: { writeDrafts?: boolean },
  dependencies?: ReleaseReadinessDependencies,
): ReleaseReadinessResult;
