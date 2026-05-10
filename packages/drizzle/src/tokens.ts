/** Dependency-injection token for the raw Drizzle database handle. */
export const DRIZZLE_DATABASE = Symbol.for('fluo.drizzle.database');
/** Dependency-injection token for the lifecycle-aware Drizzle database wrapper. */
export const DRIZZLE_HANDLE_PROVIDER = Symbol.for('fluo.drizzle.handle-provider');
/** Dependency-injection token for the optional Drizzle shutdown dispose hook. */
export const DRIZZLE_DISPOSE = Symbol.for('fluo.drizzle.dispose');
/** Dependency-injection token for normalized Drizzle runtime options. */
export const DRIZZLE_OPTIONS = Symbol.for('fluo.drizzle.options');
