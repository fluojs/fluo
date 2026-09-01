/**
 * Ordering policy for cache store operations.
 *
 * Ordinary operations run concurrently with each other, so a slow operation for one key
 * cannot block unrelated keys. Exclusive operations, such as reset and store teardown,
 * close admission for later operations, drain already-started operations, and then run alone.
 */
export class StoreOperationScheduler {
  private exclusiveTail: Promise<void> = Promise.resolve();
  private readonly activeOperations = new Set<Promise<void>>();

  /**
   * Run an ordinary store operation once any pending exclusive operation has completed.
   *
   * @param operation Store operation to run concurrently with other ordinary operations.
   * @returns The operation result, including its rejection.
   */
  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const start = (): Promise<T> => {
      const result = Promise.resolve(operation());
      const settled = result.then(
        () => undefined,
        () => undefined,
      );

      this.activeOperations.add(settled);
      void settled.then(() => {
        this.activeOperations.delete(settled);
      });

      return result;
    };

    return this.exclusiveTail.then(start, start);
  }

  /**
   * Run a store operation exclusively after every already-started operation has settled.
   *
   * Operations submitted after this call wait for the exclusive operation to complete.
   *
   * @param operation Store operation that requires exclusive store access.
   * @returns The operation result, including its rejection.
   */
  runExclusive(operation: () => Promise<void>): Promise<void> {
    const result = this.exclusiveTail.then(async () => {
      while (this.activeOperations.size > 0) {
        await Promise.all(this.activeOperations);
      }

      await operation();
    });

    this.exclusiveTail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
