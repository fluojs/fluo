type TransactionCapableDrizzle<TTransactionOptions = unknown> = {
  transaction<T>(fn: () => Promise<T>, options?: TTransactionOptions): Promise<T>;
};

type TransactionAccessor<THost, TTransactionOptions> = (
  self: THost,
) => TransactionCapableDrizzle<TTransactionOptions>;

type TransactionMethod<THost, TArgs extends unknown[], TResult> = (
  this: THost,
  ...args: TArgs
) => TResult | Promise<TResult>;

function isTransactionCapableDrizzle<TTransactionOptions>(
  value: unknown,
): value is TransactionCapableDrizzle<TTransactionOptions> {
  return typeof (value as { transaction?: unknown } | null)?.transaction === 'function';
}

function findNestedTransactionTarget<TTransactionOptions>(value: unknown): TransactionCapableDrizzle<TTransactionOptions> | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }

  const directDatabase = (value as { db?: unknown }).db;
  if (isTransactionCapableDrizzle<TTransactionOptions>(directDatabase)) {
    return directDatabase;
  }

  for (const propertyValue of Object.values(value)) {
    if (isTransactionCapableDrizzle<TTransactionOptions>(propertyValue)) {
      return propertyValue;
    }

    const nestedDatabase = (propertyValue as { db?: unknown } | null)?.db;
    if (isTransactionCapableDrizzle<TTransactionOptions>(nestedDatabase)) {
      return nestedDatabase;
    }
  }

  return undefined;
}

function resolveDefaultTransactionTarget<THost, TTransactionOptions>(
  self: THost,
): TransactionCapableDrizzle<TTransactionOptions> {
  const implicitTarget = findNestedTransactionTarget<TTransactionOptions>(self) ?? self;

  return implicitTarget as TransactionCapableDrizzle<TTransactionOptions>;
}

/**
 * Standard TC39 method decorator that runs a service method inside a Drizzle transaction boundary.
 *
 * @remarks
 * `@Transaction()` uses `this.db` when present and otherwise treats the decorated instance itself as the
 * transaction-capable `DrizzleDatabase`. Pass an accessor such as `@Transaction((self) => self.analyticsDb)` to select
 * another Drizzle wrapper explicitly. Non-function factory input is forwarded as Drizzle transaction options.
 *
 * @param accessorOrOptions Optional target accessor, or Drizzle transaction options.
 * @param options Optional Drizzle transaction options when an accessor is supplied.
 * @returns A standard 2023-11 method decorator.
 */
export function Transaction<THost, TTransactionOptions = unknown>(
  accessorOrOptions?: TransactionAccessor<THost, TTransactionOptions> | TTransactionOptions,
  options?: TTransactionOptions,
) {
  const accessor = typeof accessorOrOptions === 'function'
    ? accessorOrOptions as TransactionAccessor<THost, TTransactionOptions>
    : undefined;
  const transactionOptions = accessor ? options : accessorOrOptions as TTransactionOptions | undefined;

  return function <TArgs extends unknown[], TResult>(
    value: TransactionMethod<THost, TArgs, TResult>,
    context: ClassMethodDecoratorContext<THost, TransactionMethod<THost, TArgs, TResult>>,
  ): TransactionMethod<THost, TArgs, Promise<TResult>> {
    if (context.kind !== 'method') {
      throw new Error('@Transaction() can only decorate methods.');
    }

    return async function transactionMethod(this: THost, ...args: TArgs): Promise<TResult> {
      const drizzleDatabase = accessor ? accessor(this) : resolveDefaultTransactionTarget<THost, TTransactionOptions>(this);

      return drizzleDatabase.transaction(
        () => Promise.resolve(value.apply(this, args)),
        transactionOptions,
      );
    };
  };
}
