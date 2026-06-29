type TransactionalPrismaService<TOptions = unknown> = {
  createPlatformStatusSnapshot(): unknown;
  current(): unknown;
  transaction<T>(fn: () => Promise<T>, options?: TOptions): Promise<T>;
};

type TransactionAccessor<THost, TOptions> = (self: THost) => TransactionalPrismaService<TOptions>;

type TransactionMethod<THost, TArgs extends unknown[], TResult> = (
  this: THost,
  ...args: TArgs
) => Promise<TResult>;

function isPrismaServiceLike(value: unknown): value is TransactionalPrismaService {
  return typeof value === 'object'
    && value !== null
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

function resolveDefaultPrismaService(self: unknown): TransactionalPrismaService {
  const directPrisma = readProperty(self, 'prisma');

  if (isPrismaServiceLike(directPrisma)) {
    return directPrisma;
  }

  if (isPrismaServiceLike(self)) {
    return self;
  }

  for (const value of Object.values(Object(self) as Record<string, unknown>)) {
    if (isPrismaServiceLike(value)) {
      return value;
    }

    const nestedPrisma = readProperty(value, 'prisma');

    if (isPrismaServiceLike(nestedPrisma)) {
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
): <TArgs extends unknown[], TResult>(
  value: TransactionMethod<THost, TArgs, TResult>,
  context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
) => TransactionMethod<THost, TArgs, TResult> {
  const { accessor, options } = resolveTransactionInput(input);

  return function transactionDecorator<TArgs extends unknown[], TResult>(
    value: TransactionMethod<THost, TArgs, TResult>,
    context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
  ) {
    if (context.kind !== 'method') {
      throw new Error('@Transaction() can only decorate methods.');
    }

    return async function wrappedTransactionMethod(this: THost, ...args: TArgs): Promise<TResult> {
      const prisma = accessor?.(this) ?? resolveDefaultPrismaService(this);

      return prisma.transaction(() => value.apply(this, args), options);
    };
  };
}
