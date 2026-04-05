/** Dependency-injection token for the raw Mongoose connection handle. */
export const MONGOOSE_CONNECTION = Symbol.for('konekti.mongoose.connection');
/** Dependency-injection token for the optional Mongoose shutdown dispose hook. */
export const MONGOOSE_DISPOSE = Symbol.for('konekti.mongoose.dispose');
/** Dependency-injection token for normalized Mongoose runtime options. */
export const MONGOOSE_OPTIONS = Symbol.for('konekti.mongoose.options');
