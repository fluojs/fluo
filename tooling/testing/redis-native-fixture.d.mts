export const REDIS_NATIVE_FIXTURE_BUDGET_MS: number;
export function redisReady(chunks: readonly string[]): boolean;
export function parseRedisPort(output: string): number;
export function startRedisFixture(input: {
  readonly containerName: string;
  readonly budgetMs?: number;
  readonly execFile: (command: string, args: readonly string[]) => Promise<{ readonly stdout: string }>;
  readonly spawn: (command: string, args: readonly string[]) => import('node:child_process').ChildProcess;
  readonly waitForTcp?: (port: number, budgetMs: number) => Promise<void>;
}): Promise<{ readonly port: number; cleanup(primaryError?: unknown): Promise<void> }>;
