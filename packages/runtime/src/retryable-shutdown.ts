export type RetryableShutdownState<TPhase> = {
  complete(phase: TPhase): void;
  isComplete(phase: TPhase): boolean;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createLifecycleCloseError(errors: readonly unknown[]): Error {
  if (errors.length === 1) {
    return toError(errors[0]);
  }

  return new AggregateError(errors, 'Application close failed for one or more shutdown steps.');
}

export function createRetryableShutdownState<TPhase>(): RetryableShutdownState<TPhase> {
  const completedPhases = new Set<TPhase>();

  return {
    complete(phase) {
      completedPhases.add(phase);
    },
    isComplete(phase) {
      return completedPhases.has(phase);
    },
  };
}
