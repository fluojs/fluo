import { AfterCommitCapabilityError, type TransactionBoundaryOptions } from './after-commit.js';

import { isCompatiblePrismaServiceHandle } from './prisma-service-brand.js';
import { TransactionRollbackCapabilityError } from './result-rollback.js';

type TransactionalPrismaService<TOptions = unknown> = {
  createPlatformStatusSnapshot(): unknown;
  current(): unknown;
  transaction<T>(fn: () => Promise<T>, options?: TOptions, boundary?: TransactionBoundaryOptions<T>): Promise<T>;
};

type TransactionAccessor<THost, TOptions> = (self: THost) => TransactionalPrismaService<TOptions>;

type TransactionMethod<THost, TArgs extends unknown[], TResult> = (
  this: THost,
  ...args: TArgs
) => Promise<TResult>;

function isPrismaServiceLike(value: unknown): value is TransactionalPrismaService {
  return typeof value === 'object'
    && value !== null
    && isCompatiblePrismaServiceHandle(value)
    && 'createPlatformStatusSnapshot' in value
    && typeof value.createPlatformStatusSnapshot === 'function'
    && 'current' in value
    && typeof value.current === 'function'
    && 'transaction' in value
    && typeof value.transaction === 'function';
}

function readProperty(value: unknown, property: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }

  return Reflect.get(value, property);
}

function addPrismaServiceCandidate(
  candidates: TransactionalPrismaService[],
  value: unknown,
): void {
  if (!isPrismaServiceLike(value) || candidates.includes(value)) {
    return;
  }

  candidates.push(value);
}

function resolveDefaultPrismaService(self: unknown): TransactionalPrismaService {
  const candidates: TransactionalPrismaService[] = [];
  const directPrisma = readProperty(self, 'prisma');

  addPrismaServiceCandidate(candidates, directPrisma);
  addPrismaServiceCandidate(candidates, self);

  for (const value of Object.values(Object(self) as Record<string, unknown>)) {
    addPrismaServiceCandidate(candidates, value);

    const nestedPrisma = readProperty(value, 'prisma');
    addPrismaServiceCandidate(candidates, nestedPrisma);
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1) {
    throw new Error('Ambiguous PrismaService resolution for @Transaction(). Provide an explicit accessor function.');
  }

  throw new Error('Unable to resolve PrismaService for @Transaction(). Provide an accessor function.');
}

function isBoundaryOptions<TResult>(value: unknown): value is TransactionBoundaryOptions<TResult> {
  return typeof value === 'object'
    && value !== null
    && ('requireAfterCommit' in value || 'shouldRollback' in value);
}

/**
 * Wraps a service method in a `PrismaService.transaction(...)` boundary.
 *
 * @remarks
 * This is a TC39 standard method decorator (2023-11) and does not use legacy decorator metadata or `reflect-metadata`.
 * The canonical form is `@Transaction((self) => self.prisma, nativeOptions, boundary)`, which selects an explicit
 * service before forwarding Prisma-native options and Fluo boundary policy as separate inputs. `@Transaction()` and
 * options-only calls remain compatibility forms for existing single-target services.
 * Calls made while a transaction context is already active reuse the existing Prisma transaction through `PrismaService`.
 * Passing Prisma transaction options to a nested call is rejected by `PrismaService.transaction(...)` so option intent is not
 * silently ignored.
 *
 * @param input Explicit service accessor, or a compatibility native-options input.
 * @param options Prisma interactive transaction options for an explicit target, or a compatibility boundary input.
 * @param boundary Fluo-owned capability requirement and typed Result rollback predicate for an explicit target.
 * @returns A standard method decorator that runs the original method inside a Prisma transaction boundary.
 */
export function Transaction<THost, TOptions = unknown, TResult = unknown>(
  input?: TransactionAccessor<THost, TOptions> | TOptions,
  options?: TOptions | TransactionBoundaryOptions<TResult>,
  boundary?: TransactionBoundaryOptions<TResult>,
): <TArgs extends unknown[], TReturn extends TResult>(
  value: TransactionMethod<THost, TArgs, TReturn>,
  context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TReturn>>,
) => TransactionMethod<THost, TArgs, TReturn> {
  const accessor = typeof input === 'function'
    ? input as TransactionAccessor<THost, TOptions>
    : undefined;
  const compatibilityBoundary = accessor && boundary === undefined && isBoundaryOptions<TResult>(options)
    ? options
    : undefined;
  const nativeOptions = accessor
    ? compatibilityBoundary === undefined ? options as TOptions | undefined : undefined
    : input as TOptions | undefined;
  const transactionBoundary = accessor
    ? boundary ?? compatibilityBoundary
    : options as TransactionBoundaryOptions<TResult> | undefined;

  return function transactionDecorator<TArgs extends unknown[], TReturn extends TResult>(
    value: TransactionMethod<THost, TArgs, TReturn>,
    context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TReturn>>,
  ) {
    if (context.kind !== 'method') {
      throw new Error('@Transaction() can only decorate methods.');
    }

    return async function wrappedTransactionMethod(this: THost, ...args: TArgs): Promise<TReturn> {
      const prisma = accessor?.(this) ?? resolveDefaultPrismaService(this);

      if (transactionBoundary?.shouldRollback && !isCompatiblePrismaServiceHandle(prisma)) {
        throw new TransactionRollbackCapabilityError();
      }
      if (transactionBoundary?.requireAfterCommit && typeof readProperty(prisma, 'afterCommit') !== 'function') {
        throw new AfterCommitCapabilityError();
      }

      return transactionBoundary === undefined
        ? prisma.transaction(() => value.apply(this, args), nativeOptions)
        : prisma.transaction(() => value.apply(this, args), nativeOptions, transactionBoundary);
    };
  };
}
