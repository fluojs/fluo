/** Coordinates one absolute CQRS shutdown deadline across lifecycle drain hooks. */
export class CqrsShutdownDeadline {
  private deadlineMs: number | undefined;

  /**
   * Starts the shared deadline once.
   *
   * @param timeoutMs Configured CQRS shutdown drain duration.
   */
  start(timeoutMs: number): void {
    this.deadlineMs ??= Date.now() + timeoutMs;
  }

  /**
   * Returns the remaining duration from the shared deadline.
   *
   * @returns Remaining duration in milliseconds, or `undefined` before shutdown starts.
   */
  remainingTimeoutMs(): number | undefined {
    return this.deadlineMs === undefined ? undefined : Math.max(0, this.deadlineMs - Date.now());
  }

  /**
   * Returns the absolute timestamp for the shared deadline.
   *
   * @returns Absolute deadline in milliseconds, or `undefined` before shutdown starts.
   */
  deadlineAtMs(): number | undefined {
    return this.deadlineMs;
  }
}
