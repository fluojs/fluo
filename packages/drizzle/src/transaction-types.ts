type NativeTransactionParameters<TDatabase> =
  TDatabase extends { transaction?: (...args: infer TParameters) => Promise<unknown> }
    ? TParameters
    : [];

/**
 * Resolves the native callback handle, falling back to the root handle when there is no runner.
 *
 * @internal
 */
export type DefaultTransactionDatabase<TDatabase> =
  NativeTransactionParameters<TDatabase> extends [(database: infer TTransactionDatabase) => unknown, ...unknown[]]
    ? TTransactionDatabase
    : TDatabase;

/**
 * Resolves the native options slot, preserving the legacy option type when that slot is absent.
 *
 * @internal
 */
export type DefaultTransactionOptions<TDatabase> =
  '1' extends keyof NativeTransactionParameters<TDatabase>
    ? NativeTransactionParameters<TDatabase>[1]
    : unknown;
