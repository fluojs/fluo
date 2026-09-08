/** Work registered synchronously for sequential execution after a confirmed native commit. */
export type AfterCommitCallback = () => void | Promise<void>;

/** Fluo boundary requirements, separate from the native Drizzle transaction options. */
export interface TransactionBoundaryOptions {
  /** Reject before user work when the boundary cannot register native after-commit work. */
  readonly requireAfterCommit?: boolean;
}

/** Indicates that the current boundary cannot guarantee native after-commit execution. */
export class AfterCommitCapabilityError extends Error {
  constructor(message = 'Drizzle afterCommit requires an active native transaction boundary.') {
    super(message);
    this.name = 'AfterCommitCapabilityError';
  }
}

/**
 * Reports hook failures after the database has already committed; the transaction must not be retried.
 *
 * @remarks All registered hooks are attempted sequentially. Results retain registration order,
 * and `errors` contains only rejected reasons. This error never indicates a database rollback.
 */
export class AfterCommitError extends AggregateError {
  /** The native transaction committed before the hooks were invoked. */
  readonly committed: true = true;

  /** Creates the post-commit failure from all FIFO hook outcomes. */
  constructor(readonly results: readonly PromiseSettledResult<void>[]) {
    super(
      results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []),
      'Drizzle transaction committed, but afterCommit callbacks failed.',
    );
    this.name = 'AfterCommitError';
  }
}
