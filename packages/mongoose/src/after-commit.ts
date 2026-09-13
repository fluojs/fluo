export {
  AfterCommitCapabilityError,
  AfterCommitError,
} from '@fluojs/core';

/**
 * Reports manual session cleanup failure after commit, once all registered hooks have settled.
 *
 * @remarks
 * This error applies only when hooks were registered or a root/nested boundary required after-commit support.
 * With neither hooks nor opt-in, manual cleanup preserves the original `endSession()` error.
 * `cause` is the `endSession()` failure. `results` contains only hook outcomes in FIFO order.
 * `errors` starts with the cleanup failure, followed by rejected hook reasons in registration order.
 * The confirmed transaction must not be retried or rolled back in response to this error.
 */
export class AfterCommitCleanupError extends AggregateError {
  readonly committed = true;

  constructor(cause: unknown, readonly results: readonly PromiseSettledResult<void>[]) {
    super(
      [cause, ...results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])],
      'Mongoose transaction committed, but session cleanup failed.',
      { cause },
    );
    this.name = 'AfterCommitCleanupError';
  }
}
