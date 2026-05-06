import type { Token } from '@fluojs/core';

/** Dependency-injection token for the raw Prisma client handle. */
export const PRISMA_CLIENT = Symbol.for('fluo.prisma.client');
/** Dependency-injection token for public Prisma runtime options, such as strict transaction mode. */
export const PRISMA_OPTIONS = Symbol.for('fluo.prisma.options');

function normalizePrismaRegistrationName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new Error('PrismaModule name must be a non-empty string when provided.');
  }

  return normalizedName;
}

/**
 * Returns the DI token for the raw Prisma client bound to a registration name.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Prisma registration.
 * @returns The token that resolves the matching Prisma client instance.
 */
export function getPrismaClientToken(name?: string): Token {
  const normalizedName = normalizePrismaRegistrationName(name);

  return normalizedName === undefined
    ? PRISMA_CLIENT
    : Symbol.for(`fluo.prisma.client:${normalizedName}`);
}

/**
 * Returns the DI token for the public Prisma runtime options bound to a registration name.
 *
 * This token resolves the `PRISMA_OPTIONS` public surface consumed by `PrismaService`.
 * Normalized module options remain internal implementation details.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Prisma registration.
 * @returns The token that resolves the matching Prisma runtime options.
 */
export function getPrismaOptionsToken(name?: string): Token {
  const normalizedName = normalizePrismaRegistrationName(name);

  return normalizedName === undefined
    ? PRISMA_OPTIONS
    : Symbol.for(`fluo.prisma.options:${normalizedName}`);
}

/**
 * Returns the DI token for the transaction-aware Prisma service bound to a registration name.
 *
 * @param name Optional registration name. Omit it to target the default unnamed Prisma registration.
 * @returns The token that resolves the matching `PrismaService` instance.
 */
export function getPrismaServiceToken(name?: string): Token {
  const normalizedName = normalizePrismaRegistrationName(name);

  return normalizedName === undefined
    ? Symbol.for('fluo.prisma.service')
    : Symbol.for(`fluo.prisma.service:${normalizedName}`);
}
