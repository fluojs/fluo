const PRISMA_SERVICE_HANDLE_OWNER = Symbol.for('@fluojs/prisma/PrismaService.owner');
const PRISMA_SERVICE_HANDLE_OWNER_VERSION = 1;

function hasMethod(value: object, key: PropertyKey): boolean {
  return typeof Reflect.get(value, key) === 'function';
}

/**
 * Marks an internal Prisma service or facade handle for default `@Transaction()` resolution.
 *
 * @param handle Internal Prisma service or facade handle.
 * @returns The marked handle.
 * @internal
 */
export function markPrismaServiceHandle<THandle extends object>(handle: THandle): THandle {
  Object.defineProperty(handle, PRISMA_SERVICE_HANDLE_OWNER, {
    configurable: false,
    enumerable: false,
    value: PRISMA_SERVICE_HANDLE_OWNER_VERSION,
    writable: false,
  });

  return handle;
}

/**
 * Checks whether a value is an internally marked Prisma service or facade handle.
 *
 * @param value Candidate service or facade handle.
 * @returns Whether the value has the current Prisma owner brand.
 * @internal
 */
export function isPrismaServiceHandle(value: unknown): value is object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }

  return Reflect.get(value, PRISMA_SERVICE_HANDLE_OWNER) === PRISMA_SERVICE_HANDLE_OWNER_VERSION;
}

/**
 * Checks whether an owner-branded Prisma service exposes every decorator-consumed capability.
 *
 * @param value Candidate Prisma service or facade handle.
 * @returns Whether the compatible handle has the complete consumed surface.
 * @internal
 */
export function isCompatiblePrismaServiceHandle(value: unknown): value is object {
  return isPrismaServiceHandle(value)
    && hasMethod(value, 'createPlatformStatusSnapshot')
    && hasMethod(value, 'current')
    && hasMethod(value, 'requestTransaction')
    && hasMethod(value, 'transaction')
    && hasMethod(value, 'afterCommit');
}
