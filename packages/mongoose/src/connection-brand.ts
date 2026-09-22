const MONGOOSE_CONNECTION_OWNER = Symbol.for('@fluojs/mongoose/MongooseConnection.owner');
const MONGOOSE_CONNECTION_OWNER_VERSION = 1;

function hasMethod(value: object, key: PropertyKey): boolean {
  return typeof Reflect.get(value, key) === 'function';
}

/**
 * Marks a Mongoose connection wrapper with the owner capability consumed by transaction decorators.
 *
 * @param handle Wrapper that owns the Mongoose transaction lifecycle.
 * @returns The same owner wrapper with its non-enumerable capability marker.
 * @internal
 */
export function markMongooseConnectionHandle<THandle extends object>(handle: THandle): THandle {
  Object.defineProperty(handle, MONGOOSE_CONNECTION_OWNER, {
    configurable: false,
    enumerable: false,
    value: MONGOOSE_CONNECTION_OWNER_VERSION,
    writable: false,
  });
  return handle;
}

/**
 * Checks whether a value exposes the complete compatible Mongoose transaction surface.
 *
 * @param value Candidate wrapper received across a same-realm package boundary.
 * @returns Whether the candidate carries the supported owner marker and every consumed method.
 * @internal
 */
export function isCompatibleMongooseConnectionHandle(value: unknown): value is object {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, MONGOOSE_CONNECTION_OWNER) === MONGOOSE_CONNECTION_OWNER_VERSION
    && hasMethod(value, 'current')
    && hasMethod(value, 'currentSession')
    && hasMethod(value, 'createPlatformStatusSnapshot')
    && hasMethod(value, 'model')
    && hasMethod(value, 'requestTransaction')
    && hasMethod(value, 'transaction')
    && hasMethod(value, 'afterCommit');
}
