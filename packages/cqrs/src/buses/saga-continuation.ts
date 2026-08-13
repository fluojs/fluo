export interface SagaContinuationScope {
  readonly queue: Array<() => Promise<void>>;
}

export interface SagaDispatchOptions<TDrainAuthorization extends symbol> {
  readonly afterSagas?: () => Promise<void>;
  readonly drainAuthorization?: TDrainAuthorization;
}

export interface SagaContinuationTask<TToken> {
  readonly run: () => Promise<void>;
  readonly token: TToken;
}

export async function runSerializedSagaContinuationTasks<TToken>(
  tasks: readonly SagaContinuationTask<TToken>[],
): Promise<void> {
  const completions: Promise<void>[] = [];
  const settledChains = new Map<TToken, Promise<void>>();

  for (const task of tasks) {
    const previous = settledChains.get(task.token) ?? Promise.resolve();
    const current = previous.then(task.run);

    completions.push(current);
    settledChains.set(task.token, current.catch(() => undefined));
  }

  await Promise.all(settledChains.values());
  await Promise.all(completions);
}

export async function drainSagaContinuations(scope: SagaContinuationScope): Promise<void> {
  try {
    while (scope.queue.length > 0) {
      const continuation = scope.queue.shift();

      if (continuation) {
        await continuation();
      }
    }
  } finally {
    scope.queue.length = 0;
  }
}
