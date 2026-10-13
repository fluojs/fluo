export interface WorkspaceBuildClosureResult {
  order: string[];
  packageManager: string;
  status: number;
  stderr: string;
  stdout: string;
}

export interface RunWorkspaceBuildClosureOptions {
  packageManager?: string;
  stdio?: 'inherit' | 'pipe';
  snapshotPackages?: readonly string[];
  timeoutMs?: number;
  consume?: (result: WorkspaceBuildClosureResult) => undefined;
}

export function resolveWorkspaceBuildOrder(targetPackageName: string, rootDirectory: string): string[];

export function runWorkspaceBuildClosure(
  targetPackageName: string,
  rootDirectory: string,
  options?: RunWorkspaceBuildClosureOptions,
): WorkspaceBuildClosureResult;

export function withWorkspaceArtifactSnapshot<T>(
  packageNames: readonly string[],
  rootDirectory: string,
  consume: () => T,
): T;
