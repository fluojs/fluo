const DRIZZLE_DATABASE_OWNER = Symbol.for('@fluojs/drizzle/DrizzleDatabase.owner');
const DRIZZLE_DATABASE_OWNER_VERSION = 1;

function hasMethod(value: object, key: PropertyKey): boolean {
  return typeof Reflect.get(value, key) === 'function';
}

/** @internal */
export function markDrizzleDatabaseHandle<THandle extends object>(handle: THandle): THandle {
  Object.defineProperty(handle, DRIZZLE_DATABASE_OWNER, {
    configurable: false,
    enumerable: false,
    value: DRIZZLE_DATABASE_OWNER_VERSION,
    writable: false,
  });
  return handle;
}

/** @internal */
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
