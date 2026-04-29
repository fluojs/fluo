export interface DirectProcessEnvViolation {
  excerpt: string;
  line: number;
  path: string;
}

export interface NodeGlobalBufferViolation {
  excerpt: string;
  line: number;
  path: string;
}

export function isGovernedPackageSourcePath(relativePath: string): boolean;
export function collectDirectProcessEnvViolations(
  relativePaths: readonly string[],
  readSource: (relativePath: string) => string,
): DirectProcessEnvViolation[];
export function collectNodeGlobalBufferViolations(
  relativePaths: readonly string[],
  readSource: (relativePath: string) => string,
): NodeGlobalBufferViolation[];
export function parsePackageNamesFromFamilyTable(markdown: string, sectionTitle: string): string[];
export function enforceNoDirectProcessEnvInOrdinaryPackageSource(
  relativePaths?: readonly string[],
  readSource?: (relativePath: string) => string,
): void;
export function enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices(
  relativePaths?: readonly string[],
  readSource?: (relativePath: string) => string,
): void;
export function main(): void;
