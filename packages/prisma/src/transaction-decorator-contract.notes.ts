/**
 * TC39 standard method decorator — 2023-11 (Babel @babel/plugin-proposal-decorators)
 * NO reflect-metadata. NO experimentalDecorators.
 *
 * Factory signature:
 *   Transaction(accessor?) returns (value, context: ClassMethodDecoratorContext) => Function
 *
 * Default:    @Transaction()                         — uses `this` as the service
 * Explicit:   @Transaction((self) => self.analytics) — uses returned service property
 *
 * Nested reuse: if active context exists, reuses it (no new transaction opened)
 * Nested options: if active context exists AND options passed, THROWS
 */
export type TransactionAccessor<THost, TService> = (self: THost) => TService;

/**
 * Standard method decorator factory signature for Prisma service transaction boundaries.
 */
export type TransactionDecorator = <TService>(
  accessor?: TransactionAccessor<unknown, TService>,
) => (value: Function, context: ClassMethodDecoratorContext) => Function;
