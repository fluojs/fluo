import { CacheModule, CacheService } from '@fluojs/cache-manager';
import { type Constructor, Inject, Module } from '@fluojs/core';
import { PrismaModule, PrismaService, type PrismaServiceFacade, Transaction } from '@fluojs/prisma';

/**
 * Complete canonical catalog application from the Prisma package guide
 * (apps/docs/content/docs/packages/prisma.mdx), parameterized over the client
 * handle so the guide's fixtures can supply a driver double. The wiring,
 * decoration, lifecycle, and capability contracts exercised here belong to
 * @fluojs/prisma; native PrismaClient atomicity is verified separately by the
 * package-owned native fixture (packages/prisma/fixtures/after-commit/).
 */

export interface ProductRow {
  readonly id: string;
  readonly price: number;
}

export interface CatalogDelegate {
  adjustPrice(id: string, delta: number): Promise<ProductRow>;
}

/** Non-transactional client seam: registration, lifecycle, and facade forwarding only. */
export interface CatalogClient {
  readonly $connect: () => Promise<void>;
  readonly $disconnect: () => Promise<void>;
  readonly catalog: CatalogDelegate;
}

/** Transaction-capable client seam: adds Prisma's interactive-transaction contract. */
export interface TransactionalCatalogClient extends CatalogClient {
  $transaction<T>(callback: (tx: CatalogTransactionClient) => Promise<T>): Promise<T>;
}

/** The transaction-scoped client handed to `$transaction(...)` callbacks. */
export interface CatalogTransactionClient {
  readonly catalog: CatalogDelegate;
}

export function createCatalogApp(client: CatalogClient, options?: { strictTransactions?: boolean }): {
  CatalogModule: Constructor;
  ProductsRepository: Constructor<{
    adjust(id: string, delta: number): Promise<ProductRow>;
    adjustThroughCurrent(id: string, delta: number): Promise<ProductRow>;
    currentIsRootClient(): boolean;
  }>;
  ProductsService: Constructor<{
    adjustPrice(id: string, delta: number): Promise<ProductRow>;
    adjustPriceWithoutBoundary(id: string, delta: number): Promise<ProductRow>;
    currentIsRootClient(): boolean;
    renameWithRequiredHook(id: string): Promise<void>;
    transactionAfterShutdown(): Promise<string>;
    requestTransactionAfterShutdown(): Promise<string>;
    platformStatusSnapshot(): ReturnType<PrismaService<CatalogClient>['createPlatformStatusSnapshot']>;
  }>;
} {
  @Inject(PrismaService)
  class ProductsRepository {
    constructor(private readonly prisma: PrismaServiceFacade<CatalogClient>) {}

    adjust(id: string, delta: number) {
      // Facade forwarding: unknown properties of the injected service resolve
      // against current(), so this call joins any active transaction.
      return this.prisma.catalog.adjustPrice(id, delta);
    }

    adjustThroughCurrent(id: string, delta: number) {
      return this.prisma.current().catalog.adjustPrice(id, delta);
    }

    currentIsRootClient(): boolean {
      return this.prisma.current() === client;
    }
  }

  @Inject(PrismaService, ProductsRepository)
  class ProductsService {
    constructor(
      private readonly prisma: PrismaService<CatalogClient>,
      private readonly repo: InstanceType<typeof ProductsRepository>,
    ) {}

    /** Service transaction boundary: the canonical explicit-target decorator form. */
    @Transaction((self) => self.prisma)
    adjustPrice(id: string, delta: number) {
      return this.repo.adjust(id, delta);
    }

    /** Same read without a transaction boundary - used to compare ambient resolution. */
    adjustPriceWithoutBoundary(id: string, delta: number) {
      return this.repo.adjust(id, delta);
    }

    currentIsRootClient(): boolean {
      return this.repo.currentIsRootClient();
    }

    /** Boundary policy is checked before the callback - even without native support. */
    renameWithRequiredHook(id: string) {
      return this.prisma.transaction(async () => {
        await this.repo.adjust(id, 1);
      }, undefined, { requireAfterCommit: true });
    }

    transactionAfterShutdown() {
      return this.prisma.transaction(async () => 'unused');
    }

    requestTransactionAfterShutdown() {
      return this.prisma.requestTransaction(async () => 'unused');
    }

    platformStatusSnapshot() {
      return this.prisma.createPlatformStatusSnapshot();
    }
  }

  @Module({
    imports: [PrismaModule.forRoot({ client, strictTransactions: options?.strictTransactions })],
    providers: [ProductsRepository, ProductsService],
  })
  class CatalogModule {}

  return { CatalogModule, ProductsRepository, ProductsService };
}

export function createCatalogCacheApp(client: TransactionalCatalogClient): {
  CatalogCacheModule: Constructor;
  CatalogCacheService: Constructor<{ rename(id: string): Promise<void> }>;
  hookEvents: string[];
} {
  const hookEvents: string[] = [];

  @Inject(PrismaService, CacheService)
  class CatalogCacheService {
    constructor(
      private readonly prisma: PrismaService<TransactionalCatalogClient>,
      private readonly cache: CacheService,
    ) {}

    /** After-commit cache invalidation: the hook runs only after native commit. */
    rename(id: string) {
      return this.prisma.transaction(async () => {
        await this.prisma.current().catalog.adjustPrice(id, 5);
        this.prisma.afterCommit(async () => {
          hookEvents.push('after-commit-hook');
          await this.cache.del(`catalog:${id}`);
        });
      }, undefined, { requireAfterCommit: true });
    }
  }

  @Module({
    imports: [
      PrismaModule.forRoot({ client }),
      CacheModule.forRoot({ store: 'memory' }),
    ],
    providers: [CatalogCacheService],
  })
  class CatalogCacheModule {}

  return { CatalogCacheModule, CatalogCacheService, hookEvents };
}

export function createAsyncCatalogApp(client: CatalogClient): {
  AsyncCatalogModule: Constructor;
  AsyncProductsService: Constructor<{ currentIsConfiguredClient(): boolean }>;
} {
  const CATALOG_CONFIG = Symbol('fixture.catalog-config');

  // forRootAsync's generated module has no imports of its own, so its factory
  // dependencies must come from a globally visible module - the documented
  // contract the guide describes.
  @Module({
    global: true,
    providers: [{ provide: CATALOG_CONFIG, useValue: { strictTransactions: false } }],
    exports: [CATALOG_CONFIG],
  })
  class CatalogConfigModule {}

  @Inject(PrismaService)
  class AsyncProductsService {
    constructor(private readonly prisma: PrismaService<CatalogClient>) {}

    currentIsConfiguredClient(): boolean {
      return this.prisma.current() === client;
    }
  }

  @Module({
    imports: [
      CatalogConfigModule,
      PrismaModule.forRootAsync({
        inject: [CATALOG_CONFIG],
        useFactory: (...deps: unknown[]) => {
          const config = deps.at(0) as { strictTransactions: boolean };
          return {
            client,
            strictTransactions: config.strictTransactions,
          };
        },
      }),
    ],
    providers: [AsyncProductsService],
  })
  class AsyncCatalogModule {}

  return { AsyncCatalogModule, AsyncProductsService };
}
