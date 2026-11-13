/** Normalize a probe budget at its configuration boundary.
 * @param value Configured milliseconds.
 * @returns Positive integral milliseconds, or the 5000 ms default.
 */
export function normalizeProbeTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : 5000;
}

/** Bound asynchronous settlement without cancelling the underlying operation.
 * @param run Operation to invoke once.
 * @param timeoutMs Normalized budget in milliseconds.
 * @returns The operation value or an identifiable timeout outcome.
 */
export async function runProbeWithTimeout<T>(
  run: () => T | Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    let remaining = timeoutMs;
    const schedule = (): void => {
      // Hosts overflow delays above a signed 32-bit integer; preserve long budgets.
      const delay = Math.min(remaining, 2_147_483_647);
      timer = setTimeout(() => {
        remaining -= delay;
        if (remaining > 0) {
          schedule();
        } else {
          resolve({ timedOut: true });
        }
      }, delay);
    };
    schedule();
  });

  try {
    return await Promise.race([
      Promise.resolve().then(run).then((value) => ({ timedOut: false as const, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
