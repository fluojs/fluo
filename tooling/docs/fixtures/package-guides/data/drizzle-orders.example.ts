import { CacheModule, CacheService } from '@fluojs/cache-manager';
import { ConfigModule, ConfigService } from '@fluojs/config';
import { type Constructor, Inject, Module } from '@fluojs/core';
import { DRIZZLE_DATABASE, DrizzleDatabase, type DrizzleDatabaseFacade, DrizzleModule, Transaction } from '@fluojs/drizzle';

/**
 * Complete canonical orders application from the Drizzle package guide
 * (apps/docs/content/docs/packages/drizzle.mdx), parameterized over the
 * database handle so the guide's fixtures can supply a driver double. The
 * wiring, decoration, drain/dispose ordering, and capability contracts
 * exercised here belong to @fluojs/drizzle; native Drizzle transaction
 * atomicity is verified by the package-owned native fixture
 * (packages/prisma/fixtures/after-commit/ covers the shared driver seam).
 */

export interface OrderRow {
  readonly id: number;
  readonly customerId: string;
}

export interface OrdersDelegate {
  create(customerId: string): Promise<OrderRow>;
}

/** Root Drizzle handle seam used by repositories through the module facade. */
export interface OrdersDatabase {
  readonly orders: OrdersDelegate;
  transaction?<T>(callback: (tx: OrdersDatabase) => Promise<T>): Promise<T>;
}

export interface OrdersAppHooks {
  readonly events: string[];
}

export function createOrdersApp(
  database: OrdersDatabase,
  hooks?: { onDispose?: () => void; strictTransactions?: boolean },
): {
  OrdersModule: Constructor;
  OrdersRepository: Constructor<{
    lastCreateUsedRootHandle: boolean | undefined;
    create(customerId: string): Promise<OrderRow>;
    currentIsRootHandle(): boolean;
  }>;
  OrdersService: Constructor<{
    placeOrder(customerId: string): Promise<OrderRow>;
    currentIsRootHandle(): boolean;
    lastCreateUsedRootHandle(): boolean | undefined;
    platformStatusSnapshot(): ReturnType<DrizzleDatabase<OrdersDatabase>['createPlatformStatusSnapshot']>;
  }>;
} {
  @Inject(DrizzleDatabase)
  class OrdersRepository {
    /** Captured inside the most recent create(): was the ambient handle the root? */
    lastCreateUsedRootHandle: boolean | undefined;

    constructor(private readonly db: DrizzleDatabaseFacade<OrdersDatabase>) {}

    create(customerId: string) {
      // Facade forwarding: query properties resolve against current(), so this
      // insert runs on the transaction handle inside @Transaction.
      this.lastCreateUsedRootHandle = this.db.current() === database;
      return this.db.orders.create(customerId);
    }

    currentIsRootHandle(): boolean {
      return this.db.current() === database;
    }
  }

  @Inject(DrizzleDatabase, OrdersRepository)
  class OrdersService {
    constructor(
      private readonly db: DrizzleDatabase<OrdersDatabase>,
      private readonly repo: InstanceType<typeof OrdersRepository>,
    ) {}

    /** Service transaction boundary: the canonical explicit-target decorator form. */
    @Transaction((self) => self.db)
    placeOrder(customerId: string) {
      return this.repo.create(customerId);
    }

    currentIsRootHandle(): boolean {
      return this.repo.currentIsRootHandle();
    }

    lastCreateUsedRootHandle(): boolean | undefined {
      return this.repo.lastCreateUsedRootHandle;
    }

    platformStatusSnapshot() {
      return this.db.createPlatformStatusSnapshot();
    }
  }

  @Module({
    imports: [
      DrizzleModule.forRoot({
        database,
        strictTransactions: hooks?.strictTransactions,
        dispose: async () => {
          hooks?.onDispose?.();
        },
      }),
    ],
    providers: [OrdersRepository, OrdersService],
  })
  class OrdersModule {}

  return { OrdersModule, OrdersRepository, OrdersService };
}

export function createAsyncOrdersApp(database: OrdersDatabase, hooks?: { onDispose?: () => void }): {
  AsyncOrdersModule: Constructor;
  AsyncOrdersService: Constructor<{ currentIsRootHandle(): boolean }>;
} {
  @Inject(DrizzleDatabase)
  class AsyncOrdersService {
    constructor(private readonly db: DrizzleDatabaseFacade<OrdersDatabase>) {}

    currentIsRootHandle(): boolean {
      return this.db.current() === database;
    }
  }

  @Module({
    imports: [
      ConfigModule.forRoot({
        global: true,
        processEnv: { DATABASE_URL: 'postgres://fixture:5432/fixture' },
      }),
      DrizzleModule.forRootAsync({
        inject: [ConfigService],
        useFactory: async (...deps: unknown[]) => {
          // Prove the injected ConfigService participates in the factory.
          const config = deps.at(0) as ConfigService;
          await config.getOrThrow('DATABASE_URL');
          return {
            database,
            dispose: async () => {
              hooks?.onDispose?.();
            },
          };
        },
      }),
    ],
    providers: [AsyncOrdersService],
  })
  class AsyncOrdersModule {}

  return { AsyncOrdersModule, AsyncOrdersService };
}

export function createOrdersCacheApp(database: OrdersDatabase): {
  OrdersCacheModule: Constructor;
  OrdersCacheService: Constructor<{ createAndInvalidate(customerId: string): Promise<void> }>;
  hookEvents: string[];
} {
  const hookEvents: string[] = [];

  @Inject(DrizzleDatabase, CacheService)
  class OrdersCacheService {
    constructor(
      private readonly db: DrizzleDatabase<OrdersDatabase>,
      private readonly cache: CacheService,
    ) {}

    /** After-commit cache invalidation: the hook runs only after native commit. */
    createAndInvalidate(customerId: string) {
      return this.db.transaction(async () => {
        await this.db.current().orders.create(customerId);
        this.db.afterCommit(async () => {
          hookEvents.push('after-commit-hook');
          await this.cache.del(`orders:${customerId}`);
        });
      }, undefined, { requireAfterCommit: true });
    }
  }

  @Module({
    imports: [
      DrizzleModule.forRoot({ database }),
      CacheModule.forRoot({ store: 'memory' }),
    ],
    providers: [OrdersCacheService],
  })
  class OrdersCacheModule {}

  return { OrdersCacheModule, OrdersCacheService, hookEvents };
}

/** Token accessor for tests that assert the raw DRIZZLE_DATABASE binding. */
export { DRIZZLE_DATABASE };
