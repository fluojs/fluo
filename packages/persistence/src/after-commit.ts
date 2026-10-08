import type { AfterCommitCallback } from './transaction.js';

/**
 * Awaits every hook sequentially without discarding later work after a failure.
 * @param callbacks Hooks belonging to one successfully committed native attempt.
 * @returns Every hook outcome in registration order; cleanup errors remain adapter-owned.
 */
export async function settleAfterCommitCallbacks(
  callbacks: readonly AfterCommitCallback[],
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];
  for (const callback of callbacks) {
    try {
      await callback();
      results.push({ status: 'fulfilled', value: undefined });
    } catch (reason) {
      results.push({ status: 'rejected', reason });
    }
  }
  return results;
}
