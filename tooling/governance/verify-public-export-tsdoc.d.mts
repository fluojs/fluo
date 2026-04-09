export interface PublicExportTSDocViolation {
  kind: string;
  line: number;
  name: string;
  path: string;
  reason: string;
}

export function isGovernedPublicExportSourcePath(relativePath: string): boolean;

export function collectPublicExportTSDocViolations(
  relativePaths: string[],
  readSource?: (relativePath: string) => string,
): PublicExportTSDocViolation[];

export function enforcePublicExportTSDocBaseline(
  relativePaths?: string[],
  readSource?: (relativePath: string) => string,
): void;

export function main(): void;
