/**
 * TC39 standard method decorator contract for `Transaction`.
 *
 * - Uses the 2023-11 standard decorator shape.
 * - Does not rely on `reflect-metadata` or legacy decorator emit.
 * - The factory accepts a direct accessor function.
 * - ORM packages that expose transaction options can also accept their package-specific options object.
 */

/**
 * Resolves the transaction-facing service instance for a decorated method.
 *
 * Default behavior is implicit: `@Transaction()` uses the decorated instance itself.
 * Explicit behavior is opt-in: `@Transaction((self) => self.namedClient)` can select
 * a different service object such as a Prisma, Drizzle, or Mongoose client wrapper.
 *
 * Nested reuse is allowed by contract: if a transaction already exists for the
 * current call chain, the implementation should reuse that transaction context
 * instead of opening a nested one.
 *
 * Prisma and Drizzle may also accept package-specific transaction options at
 * the outer boundary. Nested transaction helpers reject options while an
 * ambient transaction already exists so option intent is not silently ignored.
 */
export type TransactionAccessor<T> = (self: T) => {
  transaction: Function;
  current: Function;
};

/**
 * TC39 standard method decorator contract for `Transaction`.
 *
 * The decorator returned here is a standard 2023-11 method decorator and therefore
 * receives `ClassMethodDecoratorContext` rather than any reflect-based metadata.
 */
export type TransactionDecorator = (
  value: Function,
  context: ClassMethodDecoratorContext,
) => Function | void;

/**
 * Factory shape for the shared `Transaction` decorator used by ORM packages.
 *
 * Package-local API shape:
 * - `Transaction()` => default accessor using `this`
 * - `Transaction((self) => self.namedClient)` => explicit client selection
 * - package-specific transaction options where the ORM wrapper supports them
 * - no combined object shape such as `Transaction({ accessor: ... })`
 */
export type TransactionDecoratorFactory<T> = (
  accessor?: TransactionAccessor<T>,
) => TransactionDecorator;
