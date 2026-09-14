export const REDIS_NATIVE_FIXTURE_BUDGET_MS: number;
export const REDIS_NATIVE_FIXTURE_IMAGE: string;
export function redisReady(chunks: readonly string[]): boolean;
export function parseRedisPort(output: string): number;
export type RedisFixturePhaseDiagnostic = {
  readonly argv: readonly string[];
  readonly command: string;
  readonly elapsedMs: number;
  readonly error?: string;
  readonly exitCode: number | null;
  readonly name: string;
  readonly signal: string | null;
  readonly spawnError: string | null;
  readonly status: 'passed' | 'failed';
  readonly stderr: string;
  readonly stdout: string;
};
export function startRedisFixture(input: {
  readonly containerName: string;
  readonly budgetMs?: number;
  readonly diagnosticPath?: string;
  readonly execFile: (
    command: string,
    args: readonly string[],
    options: { readonly timeout: number },
  ) => Promise<{ readonly code?: number; readonly signal?: string | null; readonly stderr?: string; readonly stdout: string }>;
  readonly now?: () => number;
  readonly spawn: (command: string, args: readonly string[]) => import('node:child_process').ChildProcess;
  readonly waitForTcp?: (port: number, budgetMs: number) => Promise<void>;
}): Promise<{
  readonly diagnostics: {
    readonly budgetMs: number;
    readonly containerName: string;
    readonly image: string;
    readonly phases: readonly RedisFixturePhaseDiagnostic[];
  };
  readonly port: number;
  cleanup(primaryError?: unknown): Promise<void>;
}>;
