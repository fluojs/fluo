import { Inject } from '@fluojs/core';
import type { Interceptor, InterceptorContext } from '@fluojs/http';

import { PrismaService } from './service.js';
import type { PrismaClientLike } from './types.js';

type TransactionalPrismaService<TOptions = unknown> = {
  transaction<T>(fn: () => Promise<T>, options?: TOptions): Promise<T>;
};

type TransactionAccessor<THost, TOptions> = (self: THost) => TransactionalPrismaService<TOptions>;

function hasTransaction(value: unknown): value is TransactionalPrismaService {
  return typeof value === 'object'
    && value !== null
    && 'transaction' in value
    && typeof value.transaction === 'function';
}

function readProperty(value: unknown, property: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }

  return Reflect.get(value, property);
}

function resolveDefaultPrismaService(self: unknown): TransactionalPrismaService {
  const directPrisma = readProperty(self, 'prisma');

  if (hasTransaction(directPrisma)) {
    return directPrisma;
  }

  if (hasTransaction(self)) {
    return self;
  }

  for (const value of Object.values(Object(self) as Record<string, unknown>)) {
    if (hasTransaction(value)) {
      return value;
    }

    const nestedPrisma = readProperty(value, 'prisma');

    if (hasTransaction(nestedPrisma)) {
      return nestedPrisma;
    }
  }

  throw new Error('Unable to resolve PrismaService for @Transaction(). Provide an accessor function.');
}

function resolveTransactionInput<THost, TOptions>(
  input?: TransactionAccessor<THost, TOptions> | TOptions,
): {
  accessor?: TransactionAccessor<THost, TOptions>;
  options?: TOptions;
} {
  if (typeof input === 'function') {
    return { accessor: input as TransactionAccessor<THost, TOptions> };
  }

  return { options: input };
}

/**
 * Wraps a service method in a `PrismaService.transaction(...)` boundary.
 *
 * @remarks
 * This is a TC39 standard method decorator (2023-11) and does not use legacy decorator metadata or `reflect-metadata`.
 * `@Transaction()` resolves a Prisma service from the decorated instance, while
 * `@Transaction((self) => self.prisma)` selects an explicit service for named or multi-client registrations.
 * Calls made while a transaction context is already active reuse the existing Prisma transaction through `PrismaService`.
 * Passing Prisma transaction options to a nested call is rejected by `PrismaService.transaction(...)` so option intent is not
 * silently ignored.
 *
 * @param input Optional service accessor or Prisma interactive transaction options.
 * @returns A standard method decorator that runs the original method inside a Prisma transaction boundary.
 */
export function Transaction<THost, TOptions = unknown>(
  input?: TransactionAccessor<THost, TOptions> | TOptions,
): (value: (this: THost, ...args: never[]) => Promise<unknown>, context: ClassMethodDecoratorContext) => unknown {
  const { accessor, options } = resolveTransactionInput(input);

  return (value, context) => {
    if (context.kind !== 'method') {
      throw new Error('@Transaction() can only decorate methods.');
    }

    return async function wrappedTransactionMethod(this: THost, ...args: never[]) {
      const prisma = accessor?.(this) ?? resolveDefaultPrismaService(this);

      return prisma.transaction(() => value.apply(this, args), options);
    };
  };
}

/**
 * HTTP interceptor that wraps a request handler in `PrismaService.requestTransaction(...)`.
 *
 * @remarks
 * Pair this with repository/service code that reads `PrismaService.current()` so downstream calls share the same
 * request-scoped transaction client.
 */
@Inject(PrismaService)
export class PrismaTransactionInterceptor implements Interceptor {
  constructor(private readonly prisma: PrismaService<PrismaClientLike>) {}

  /**
   * Runs the downstream handler inside a Prisma request transaction boundary.
   *
   * @param context Interceptor context that supplies the request abort signal.
   * @param next Downstream handler chain.
   * @returns The downstream handler result after the request transaction settles.
   */
  async intercept(context: InterceptorContext, next: { handle(): Promise<unknown> }): Promise<unknown> {
    return this.prisma.requestTransaction(async () => next.handle(), context.requestContext.request.signal);
  }
}
