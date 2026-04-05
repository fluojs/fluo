/** Dependency-injection token for the raw Drizzle database handle. */
export const DRIZZLE_DATABASE = Symbol.for('konekti.drizzle.database');
/** Dependency-injection token for the optional Drizzle shutdown dispose hook. */
export const DRIZZLE_DISPOSE = Symbol.for('konekti.drizzle.dispose');
/** Dependency-injection token for normalized Drizzle runtime options. */
export const DRIZZLE_OPTIONS = Symbol.for('konekti.drizzle.options');
