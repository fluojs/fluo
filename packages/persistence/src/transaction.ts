/** Callback invoked and awaited after a successful Fluo-owned native commit. */
export type AfterCommitCallback = () => void | Promise<void>;

/** Opt-in requirements for a Fluo transaction boundary, separate from native driver options. */
export interface TransactionBoundaryOptions<T = unknown> {
  /** Reject unsupported native commit tracking before invoking the transaction callback. */
  readonly requireAfterCommit?: boolean;
  /**
   * Marks the shared owner rollback-only when the application predicate accepts a resolved value.
   * @param value Original callback result; no Result convention is inferred.
   * @returns Whether this value requires native rollback instead of commit.
   */
  readonly shouldRollback?: (value: T) => boolean;
}

/** Reports that a Fluo-owned native commit boundary is unavailable. */
export class AfterCommitCapabilityError extends Error {
  constructor(message = 'afterCommit requires a Fluo-owned native transaction boundary.') {
    super(message);
    this.name = 'AfterCommitCapabilityError';
  }
}

/** Reports hook failures after the database has already committed; never retry the transaction for this error. */
export class AfterCommitError extends AggregateError {
  /** The native transaction committed successfully before these hook results were collected. */
  readonly committed = true as const;

  /**
   * Collects all hook outcomes in registration order.
   *
   * @param results Settled results for every registered callback, including successes.
   */
  constructor(readonly results: readonly PromiseSettledResult<void>[]) {
    super(
      results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []),
      'Transaction committed, but one or more afterCommit hooks failed.',
    );
    this.name = 'AfterCommitError';
  }
}

/** Reports that native rollback could not be positively confirmed; never a normal domain Result. */
export class TransactionRollbackUnconfirmedError extends Error {
  constructor(options?: ErrorOptions) {
    super('Native rollback outcome could not be confirmed.', options);
    this.name = 'TransactionRollbackUnconfirmedError';
  }
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
