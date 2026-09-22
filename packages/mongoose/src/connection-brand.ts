const MONGOOSE_CONNECTION_OWNER = Symbol.for('@fluojs/mongoose/MongooseConnection.owner');
const MONGOOSE_CONNECTION_OWNER_VERSION = 1;

function hasMethod(value: object, key: PropertyKey): boolean {
  return typeof Reflect.get(value, key) === 'function';
}

/** @internal */
export function markMongooseConnectionHandle<THandle extends object>(handle: THandle): THandle {
  Object.defineProperty(handle, MONGOOSE_CONNECTION_OWNER, {
    configurable: false,
    enumerable: false,
    value: MONGOOSE_CONNECTION_OWNER_VERSION,
    writable: false,
  });
  return handle;
}

/** @internal */
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
