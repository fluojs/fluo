/** Positive native rollback evidence for exactly one callback attempt. */
export interface TransactionRollbackObservation {
  /** Rejects with the observed native failure or an unconfirmed-outcome error unless rollback is positively confirmed. */
  confirmRollback(): true | Promise<true>;
}

/** Public driver observation capability installed before native transaction work begins. */
export interface TransactionRollbackObserver {
  /** Opens an isolated observation scope around one owning native invocation, including retries and cleanup. */
  run<T>(callback: () => Promise<T>): Promise<T>;
  /** Binds positive rollback evidence to this exact native callback attempt, before application work. */
  beginAttempt(transaction: unknown): TransactionRollbackObservation;
}

/** Reports that native rollback could not be positively confirmed; never a normal domain Result. */
export class TransactionRollbackUnconfirmedError extends Error {
  constructor(options?: ErrorOptions) {
    super('Native rollback outcome could not be confirmed.', options);
    this.name = 'TransactionRollbackUnconfirmedError';
  }
}

/**
 * Runs a native invocation under its explicitly registered public observation capability.
 * @param observer Optional registered native observation capability.
 * @param callback Native invocation, including callback attempts and native settlement.
 * @returns The original native invocation outcome after observation scope settlement.
 */
export function observeRollback<T>(observer: TransactionRollbackObserver | undefined, callback: () => Promise<T>): Promise<T> {
  return observer ? observer.run(callback) : callback();
}

/** Reports that an opt-in Result policy cannot own a native rollback boundary. */
export class TransactionRollbackCapabilityError extends Error {
  constructor() {
    super('Result rollback requires a Fluo-owned native transaction boundary.');
    this.name = 'TransactionRollbackCapabilityError';
  }
}

/** Reports a sticky nested failure when the outer callback did not return an opted-in failure. */
export class TransactionRollbackOnlyError extends Error {
  /**
   * Identifies the first value that marked the shared owner rollback-only.
   * @param result Original nested failure value; no Result shape is assumed.
   */
  constructor(readonly result: unknown) {
    super('Transaction is rollback-only because a nested Result policy rejected its value.');
    this.name = 'TransactionRollbackOnlyError';
  }
}

/** Mutable policy state shared only by callbacks in one native attempt. */
export interface RollbackOwner {
  rollbackOnly?: TransactionRollbackOnlyError;
  observation?: TransactionRollbackObservation;
}

/**
 * Evaluates an explicitly supplied nested policy without claiming native completion.
 * @param owner Shared native attempt state.
 * @param value Original callback value.
 * @param shouldRollback Optional application-owned failure predicate.
 * @returns The unchanged callback value.
 */
export function evaluateResult<T>(owner: RollbackOwner, value: T, shouldRollback?: (value: T) => boolean): T {
  if (shouldRollback?.(value)) {
    owner.rollbackOnly ??= new TransactionRollbackOnlyError(value);
  }
  return value;
}

/** Recovers this root's failure only after its owned signal and positive native rollback confirmation. */
export class ResultBoundary<T> {
  private failure?: { readonly value: T; readonly error: TransactionRollbackOnlyError };

  constructor(private readonly owner: RollbackOwner, private readonly shouldRollback?: (value: T) => boolean) {}

  evaluate(value: T): T {
    if (this.shouldRollback?.(value)) {
      this.owner.rollbackOnly ??= new TransactionRollbackOnlyError(value);
      this.failure = { value, error: this.owner.rollbackOnly };
    }
    return value;
  }

  assertCommittable(): void {
    if (this.owner.rollbackOnly) throw this.owner.rollbackOnly;
  }

  async recover(error: unknown): Promise<T> {
    if (!this.owner.rollbackOnly || error !== this.owner.rollbackOnly) throw error;
    if (!this.owner.observation) throw new TransactionRollbackUnconfirmedError({ cause: error });
    if (await this.owner.observation.confirmRollback() !== true) throw new TransactionRollbackUnconfirmedError({ cause: error });
    if (this.failure && error === this.failure.error) return this.failure.value;
    throw error;
  }
}
