/**
 * Waits until a mutable set of saga tasks becomes quiescent within one deadline.
 *
 * @param pendingDispatches Live saga task set owned by the lifecycle service.
 * @param timeoutMs Maximum drain duration in milliseconds.
 * @returns `true` when all current and late-added tasks settle before the deadline.
 */
export async function drainPendingSagaDispatches(
  pendingDispatches: ReadonlySet<Promise<void>>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (pendingDispatches.size > 0) {
    const remainingTimeoutMs = deadline - Date.now();

    if (remainingTimeoutMs <= 0) {
      return false;
    }

    if (!(await awaitSagaTasks([...pendingDispatches], remainingTimeoutMs))) {
      return false;
    }
  }

  return true;
}

async function awaitSagaTasks(activeWork: readonly Promise<void>[], timeoutMs: number): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });
  const drain = Promise.allSettled(activeWork).then(() => true);

  try {
    return await Promise.race([drain, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
