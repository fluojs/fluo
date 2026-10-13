import type { ChildProcess } from 'node:child_process';

export function createWorkspaceArtifactWriter(
  artifact: string,
  rootDirectory: string,
  options?: { readonly timeoutMs?: number; readonly pauseAfterPublication?: 'gate' | 'artifact' },
): {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
  readonly exited: Promise<[number | null, NodeJS.Signals | null]>;
  readonly events: readonly string[];
  attempt(): { readonly event: 'blocked' | 'published'; readonly pid: number; readonly path?: string };
  stop(): Promise<void>;
};

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
