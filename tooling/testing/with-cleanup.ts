type Cleanup = () => unknown | Promise<unknown>;

// Repository-private test ownership; never intercepts Test factories or runner hooks.
export async function withCleanup<T>(
  operation: (defer: (cleanup: Cleanup) => void) => T | Promise<T>,
): Promise<T> {
  const cleanups: Cleanup[] = [];
  const failures: unknown[] = [];
  let outcome:
    | { readonly kind: 'failure'; readonly error: unknown }
    | { readonly kind: 'success'; readonly value: T }
    | undefined;

  try {
    outcome = { kind: 'success', value: await operation((cleanup) => { cleanups.push(cleanup); }) };
  } catch (error) {
    failures.push(error);
    outcome = { kind: 'failure', error };
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Operation and cleanup failed.');

  if (!outcome || outcome.kind === 'failure') throw outcome?.error;
  return outcome.value;
}
