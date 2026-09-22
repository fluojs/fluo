import { CacheEvict, CacheInterceptor, CacheModule, type CacheModuleOptions, CacheService, type CacheStore, CacheTTL } from '@fluojs/cache-manager';
import { type Constructor, Inject, Module } from '@fluojs/core';
import { Controller, FromBody, Get, Post, RequestDto, UseInterceptors } from '@fluojs/http';

/**
 * Complete canonical products application from the Cache manager package guide
 * (apps/docs/content/docs/packages/cache-manager.mdx): HTTP response caching
 * with `CacheInterceptor` plus programmatic read-through caching with
 * `CacheService`. The store is injectable so fixtures can supply a recording
 * store or the built-in memory store.
 */

export interface RecordingStore extends CacheStore {
  readonly entries: Map<string, { expiresAt?: number; value: unknown }>;
  readonly writtenTtls: number[];
}

/** Minimal map-backed store that records the TTL values it receives. */
export function createRecordingStore(): RecordingStore {
  const entries = new Map<string, { expiresAt?: number; value: unknown }>();
  const writtenTtls: number[] = [];
  return {
    entries,
    writtenTtls,
    async get<T>(key: string) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return structuredClone(entry.value) as T;
    },
    async set<T>(key: string, value: T, ttlSeconds?: number) {
      writtenTtls.push(ttlSeconds ?? 0);
      const expiresAt = ttlSeconds !== undefined && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
      entries.set(key, { expiresAt, value: structuredClone(value) });
    },
    async del(key: string) {
      entries.delete(key);
    },
    async reset() {
      entries.clear();
    },
  };
}

export interface ProductsAppOptions {
  store?: CacheModuleOptions['store'];
  ttl?: number;
  ttlJitter?: CacheModuleOptions['ttlJitter'];
  observer?: CacheModuleOptions['observer'];
}

export interface ProductRow {
  readonly id: number;
  readonly name: string;
}

export function createProductsApp(options: ProductsAppOptions = {}): {
  ProductsModule: Constructor;
  ProductsController: Constructor;
  ProductsService: Constructor<{
    loaderRuns: number;
    handlerRuns: number;
    rememberCatalog(load: () => Promise<readonly ProductRow[]>): Promise<readonly ProductRow[]>;
    create(name: string): ProductRow;
    list(): readonly ProductRow[];
    incrementCounter(key: string): Promise<number | undefined>;
  }>;
} {
  @Inject(CacheService)
  class ProductsService {
    loaderRuns = 0;
    handlerRuns = 0;
    private readonly items: ProductRow[] = [{ id: 1, name: 'Product A' }];

    constructor(private readonly cache: CacheService) {}

    /** Read-through loading: the loader runs only on a cache miss. */
    rememberCatalog(load: () => Promise<readonly ProductRow[]>) {
      this.loaderRuns += 1;
      return this.cache.remember('products:all', load, 300);
    }

    create(name: string): ProductRow {
      const product = { id: this.items.length + 1, name };
      this.items.push(product);
      return product;
    }

    list(): readonly ProductRow[] {
      return this.items.slice();
    }

    /** Atomic read-modify-write through the store's update capability. */
    incrementCounter(key: string) {
      return this.cache.update<number>(key, (value) => ({
        action: 'set',
        value: (value ?? 0) + 1,
      }));
    }
  }

  class CreateProductDto {
    @FromBody()
    name = '';
  }

  @Inject(ProductsService)
  @Controller('/products')
  class ProductsController {
    constructor(private readonly products: ProductsService) {}

    @Get()
    @UseInterceptors(CacheInterceptor)
    @CacheTTL(60)
    list() {
      this.products.handlerRuns += 1;
      return this.products.list();
    }

    @Post()
    @UseInterceptors(CacheInterceptor)
    @RequestDto(CreateProductDto)
    @CacheEvict('/products')
    create(input: CreateProductDto): ProductRow {
      return this.products.create(input.name);
    }

    /** Uncached diagnostics route used by the guide's fixtures. */
    @Get('/handler-runs')
    handlerRuns() {
      return { runs: this.products.handlerRuns };
    }
  }

  @Module({
    imports: [
      CacheModule.forRoot({
        store: options.store ?? 'memory',
        ttl: options.ttl ?? 60,
        ...(options.ttlJitter !== undefined && { ttlJitter: options.ttlJitter }),
        ...(options.observer !== undefined && { observer: options.observer }),
      }),
    ],
    controllers: [ProductsController],
    providers: [ProductsService],
  })
  class ProductsModule {}

  return { ProductsModule, ProductsController, ProductsService };
}
