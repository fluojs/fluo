const brandedPrismaServiceHandles = new WeakSet<object>();

/**
 * Marks an internal Prisma service or facade handle for default `@Transaction()` resolution.
 *
 * @internal
 */
export function markPrismaServiceHandle<THandle extends object>(handle: THandle): THandle {
  brandedPrismaServiceHandles.add(handle);

  return handle;
}

/**
 * Checks whether a value is an internally marked Prisma service or facade handle.
 *
 * @internal
 */
export function isPrismaServiceHandle(value: unknown): value is object {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }

  return brandedPrismaServiceHandles.has(value);
}
