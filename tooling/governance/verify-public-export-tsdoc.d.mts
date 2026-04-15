export type PublicExportTSDocViolation = {
  kind: string;
  line: number;
  name: string;
  path: string;
  reason: string;
};

export function isGovernedPublicExportSourcePath(relativePath: string): boolean;

export function changedPublicExportSourcePathsFromGit(
  relativePaths?: string[],
  readSource?: (relativePath: string) => string,
  gitRef?: string | null,
  readSourceAtRef?: (gitRef: string | null, relativePath: string) => string | null,
  hasChangedPublicExportDeclarations?: (...args: unknown[]) => boolean,
): string[];

export function governedPublicExportSourcePathsFromWorkspace(relativePaths?: string[]): string[];

export function publicExportTSDocTargetPaths(mode?: 'changed' | 'full', changedPaths?: string[], workspacePaths?: string[]): string[];

export function collectPublicExportTSDocViolations(
  relativePaths: string[],
  readSource?: (relativePath: string) => string,
): PublicExportTSDocViolation[];

export function enforcePublicExportTSDocBaseline(
  relativePaths?: string[],
  readSource?: (relativePath: string) => string,
  mode?: 'changed' | 'full',
): void;

export function enforcePublicExportTSDocBaselineForMode(
  mode?: 'changed' | 'full',
  readSource?: (relativePath: string) => string,
  changedPaths?: string[],
  workspacePaths?: string[],
): void;
