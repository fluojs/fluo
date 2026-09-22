const DRIZZLE_DATABASE_OWNER = Symbol.for('@fluojs/drizzle/DrizzleDatabase.owner');
const DRIZZLE_DATABASE_OWNER_VERSION = 1;

function hasMethod(value: object, key: PropertyKey): boolean {
  return typeof Reflect.get(value, key) === 'function';
}

/**
 * Marks a Drizzle wrapper with the owner capability consumed by transaction decorators.
 *
 * @param handle Wrapper that owns the Drizzle transaction lifecycle.
 * @returns The same owner wrapper with its non-enumerable capability marker.
 * @internal
 */
export function markDrizzleDatabaseHandle<THandle extends object>(handle: THandle): THandle {
  Object.defineProperty(handle, DRIZZLE_DATABASE_OWNER, {
    configurable: false,
    enumerable: false,
    value: DRIZZLE_DATABASE_OWNER_VERSION,
    writable: false,
  });
  return handle;
}

/**
 * Checks whether a value exposes the complete compatible Drizzle transaction surface.
 *
 * @param value Candidate wrapper received across a same-realm package boundary.
 * @returns Whether the candidate carries the supported owner marker and every consumed method.
 * @internal
 */
export function isCompatibleDrizzleDatabaseHandle(value: unknown): value is object {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, DRIZZLE_DATABASE_OWNER) === DRIZZLE_DATABASE_OWNER_VERSION
    && hasMethod(value, 'current')
    && hasMethod(value, 'createPlatformStatusSnapshot')
    && hasMethod(value, 'requestTransaction')
    && hasMethod(value, 'transaction')
    && hasMethod(value, 'afterCommit');
}
