import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

export interface ChildRuntimeHandle {
  readonly child: ChildProcess;
  readonly listening: Promise<string>;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
}

/**
 * Spawns a fixture runtime app and exposes event-based barriers for the
 * `FLUO_LISTENING <url>` stdout sentinel and process exit. There are no
 * polling delays: every wait subscribes to the exact event it awaits, with a
 * rejecting bounded timeout as the only guard.
 */
export function spawnRuntimeApp(
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): ChildRuntimeHandle {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const child = spawn(command, [...args], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrChunks: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const listening = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${command} did not print FLUO_LISTENING within ${String(timeoutMs)}ms.`));
    }, timeoutMs);
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const sentinelIndex = buffer.indexOf('FLUO_LISTENING ');
      if (sentinelIndex >= 0) {
        clearTimeout(timeout);
        const newlineIndex = buffer.indexOf('\n', sentinelIndex);
        resolve(buffer.slice(sentinelIndex + 'FLUO_LISTENING '.length, newlineIndex).trim());
      }
    });
    child.once('error', (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn ${command}: ${error.message}`));
    });
  });

  const exited = once(child, 'close').then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  }));

  return {
    child,
    listening,
    exited: bounded(exited, `${command} exit`, timeoutMs),
  };
}

/** Rejects when the awaited promise does not settle within the bound. */
export function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} did not settle within ${String(timeoutMs)}ms.`));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/** Minimal Worker execution context double that only records `waitUntil` promises. */
export class RecordingExecutionContext {
  readonly tracked: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.tracked.push(promise);
  }
}
