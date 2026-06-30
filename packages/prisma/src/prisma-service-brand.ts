/**
 * Internal marker used to distinguish Prisma service/facade handles from other persistence transaction facades.
 *
 * @internal
 */
export const PRISMA_SERVICE_BRAND: unique symbol = Symbol('@fluojs/prisma/service');

/**
 * Internal shape implemented by Prisma service handles that can back the default `@Transaction()` target resolution.
 *
 * @internal
 */
export type BrandedPrismaServiceHandle = {
  readonly [PRISMA_SERVICE_BRAND]: true;
};
