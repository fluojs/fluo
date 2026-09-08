/** Callback invoked and awaited after a successful Fluo-owned native commit. */
export type AfterCommitCallback = () => void | Promise<void>;

/** Opt-in requirements for a Fluo transaction boundary, separate from native options. */
export interface TransactionBoundaryOptions {
  /** Reject unsupported native commit tracking before invoking the transaction callback. */
  readonly requireAfterCommit?: boolean;
}

/** Reports that a Fluo-owned native commit boundary is unavailable. */
export class AfterCommitCapabilityError extends Error {
  constructor() {
    super('afterCommit requires a Fluo-owned native transaction boundary.');
    this.name = 'AfterCommitCapabilityError';
  }
}

/** Reports hook failures after the database has already committed; never retry the transaction for this error. */
export class AfterCommitError extends AggregateError {
  /** The native transaction committed successfully before these hook results were collected. */
  readonly committed = true;

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
