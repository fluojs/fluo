# Compiling the Module Graph

<!-- book:volume=03-internals;chapter=08 -->

[Previous: When Instances Are Created and Disposed](./ch07-scopes-and-disposal.md) | [Volume 3 Contents](./toc.md) | [Next: Application Startup and Failure Recovery](./ch09-bootstrap-and-rollback.md)

## Why Can It Not Be Injected If It Is in the Container?

After adding the shop to the blog, we wanted the order service to use `CatalogModule`'s internal product store directly. It seemed reasonable: both were in the same process, and the store was registered in the container. Assembling the modules, however, produced `ModuleVisibilityError`. The product module exported only its product reader token, not the internal store class.

Registering the internal store in the order module as well might make the application run for the moment. In exchange, store instances may be duplicated, or the winning registration for the same token may depend on assembly order. Changing the product module's internal implementation would then require changes to the order module too. The module graph does more than collect dependency lists: it detects incorrect connections like these before execution.

The previous three chapters covered how a token is registered, resolved, and disposed. We now examine the path from an `@fluojs/core` `@Module` declaration through compilation in `@fluojs/runtime` to `Container.register()`. Compilation here is not a build that transforms TypeScript into JavaScript. It is a runtime preparation step that takes already-evaluated module classes and metadata, then computes and validates dependency order and sets of accessible tokens.

The product premise of a single application remains intact. `AccountsModule` continues to own the blog accounts, `PostsModule` retains posts, and `CatalogModule` and `OrdersModule` are added on top. The small account and product implementations in this chapter are in-memory stand-ins for a compilation experiment. They are not a design for recreating the existing account table or splitting services into multiple processes.

## File Imports and Module Imports Are Different Connections

The TypeScript statement `import { CATALOG_READER } from './catalog-reader.js'` gives access to a JavaScript value. `@Module({ imports: [CatalogModule] })` makes the tokens exported by that module available in the Fluo module graph. The first alone lets you write the token's name in source code but does not grant injection visibility. The second alone does not automatically infer constructor argument types either. The consumer needs class-level `@Inject(CATALOG_READER)`.

`providers` registers implementations owned by this module, while `exports` lists tokens to expose to other modules. `controllers` is a separate list for controller discovery and registration. Importing a module does not make all of its internal providers visible. If `CatalogModule` exports `CATALOG_READER` and `OrdersModule` imports it, orders need to know only the reader port. The token and contract can remain intact even when the internal in-memory store changes to a Prisma implementation.

Re-exports are explicit too. An intermediate module importing another module does not automatically forward that module's exports to the next consumer. The intermediate module must list the token again in its own `exports`. The token must be either one of its own providers or a token actually exported by an imported module. A token being visible somewhere globally is not enough to export it when the module neither owns it nor has received it through an import.

`@Module({ global: true })` makes the exports of a global module that has entered the graph visible without an explicit import. It does not automatically discover every global module whose class exists on disk. This is useful for foundations such as shared configuration that must be supplied consistently across features. Making every internal account and order implementation global, however, reduces the benefits of boundary validation. For this shop, we choose to keep feature dependencies readable in `imports`.

When applying this to the actual application, file boundaries can be arranged as follows. The table shows where to move the classes from the experimental file below into the application; it does not claim that these files already exist as completed implementations in the repository.

| Application file | Contract it owns |
| --- | --- |
| `src/accounts/account-reader.ts` | Existing account reader port and the `ACCOUNT_READER` token |
| `src/accounts/accounts.module.ts` | Connection between the existing account implementation and its public reader token |
| `src/catalog/catalog-reader.ts` | Port for reading server-side prices by SKU and the `CATALOG_READER` token |
| `src/catalog/catalog.module.ts` | Product implementation registration and reader port export |
| `src/orders/order-preview.ts` | Order preview receiving both reader ports through injection |
| `src/orders/orders.module.ts` | Account and product module imports and order feature exports |
| `src/app.ts` | Application assembly retaining the existing posts module |

## The Compiler Orders Modules First

Core's `Module()` records the module definition in the metadata store. Runtime's `compileModuleGraph()` reads those records and traverses reachable modules. This function is a symbol to look for when reading the internal implementation; the application experiment in this chapter reaches it through the public `bootstrapModule()`. Being exported within a file and being part of the package root's public API are different things.

`compileModule()` distinguishes the map of completed modules from the set of modules currently being visited. A completed module is reused. Encountering a module still being visited means an import cycle and causes `ModuleGraphError`. The function recursively compiles the module's imports first, then adds its own record to the ordered array last. Dependencies therefore precede their consumers. Even if several features import the same `AccountsModule`, they converge on one compilation record when the class identity is the same.

No instances are created at this stage. Module definitions are normalized and `providerTokens` sets are constructed. Provider declarations pass through DI's `validateProviderInputs()` and are validated with the canonical normalization rules from Chapter 5. The cache key creation path also uses this validation. This is why a declaration that incorrectly puts a string in `inject` should fail with `InvalidProviderError`, rather than an incidental `TypeError` during visibility traversal.

Injection metadata validation is another layer. A valid token shape is different from declaring enough tokens for a constructor. Runtime checks a class's explicit injection metadata and constructor argument count to diagnose missing declarations. It is not a type checker that reconstructs TypeScript interfaces at runtime. Rules also cover default arguments and an explicitly empty `@Inject()`, so constructor names alone must not be described as providing complete type safety.

Module cycles and provider cycles must be distinguished as well. Cyclic module imports fail during compilation. Even with an acyclic module graph, two providers within one module that depend on each other through their constructors can produce the resolution-stage cycle error seen in Chapter 6. The former is fixed in the import structure between modules; the latter is fixed in the creation responsibilities between objects.

## Building the Set of Accessible Tokens

Once dependency order is ready, `validateCompiledModules()` computes visibility for each module. The current module's `accessibleTokens` combines local provider tokens, exports from directly imported modules, exports from global modules, and runtime tokens supplied by bootstrap. `importedExportedTokens` and `exportedTokens` are kept separately to avoid confusing what a consumer can see with what it can re-export.

That set is used to check provider and controller dependencies. An alias's `useExisting` is also a dependency edge. Creating an alias that points to a product store hidden from the outside cannot bypass visibility checks. `optional` is not permission to cross a hidden boundary either. An optional token registered nowhere in the graph can be omitted, but a token registered in another module and invisible to this module causes a visibility error.

That last distinction is especially important. If optional injection always treated invisible tokens as absent, a configuration error caused by a missing import or export would silently turn into a disabled feature. Conversely, it must be possible to express that an observability add-on truly not installed is allowed to be absent. This distinction is why the compiler retains both the complete set of registered tokens and each module's accessible set.

## Reproducing Success and Hidden-Token Failures with the Same Product

The following is the complete file `fluo-blog/src/experiments/module-compilation.test.ts`. The order preview uses a verified customer ID and prices read on the server. It neither charges nor persists anything, and it rejects missing accounts, missing SKUs, and invalid quantities with separate errors. This is not an HTTP exception mapping experiment, so do not assume that the `Error` values below are automatically converted to particular HTTP statuses.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { Inject, Module } from '@fluojs/core';
import { Optional } from '@fluojs/di';
import { bootstrapModule, FluoFactory, ModuleGraphCompileCache, ModuleVisibilityError } from '@fluojs/runtime';

interface AccountReader {
  exists(customerId: number): boolean;
}

interface ProductPrice {
  sku: string;
  currency: 'KRW';
  unitMinor: number;
}

interface CatalogReader {
  find(sku: string): ProductPrice | undefined;
}

const ACCOUNT_READER = Symbol('ACCOUNT_READER');
const CATALOG_READER = Symbol('CATALOG_READER');
const HIDDEN_ALIAS = Symbol('HIDDEN_ALIAS');

class MemoryAccounts implements AccountReader {
  exists(customerId: number): boolean {
    return customerId === 7;
  }
}

class MemoryCatalog implements CatalogReader {
  static constructions = 0;

  constructor() {
    MemoryCatalog.constructions += 1;
  }

  find(sku: string): ProductPrice | undefined {
    if (sku !== 'FLUO-TEE-BLACK-M') return undefined;
    return { sku, currency: 'KRW', unitMinor: 25000 };
  }
}

@Module({
  providers: [
    MemoryAccounts,
    { provide: ACCOUNT_READER, useExisting: MemoryAccounts },
  ],
  exports: [ACCOUNT_READER],
})
class AccountsModule { }

@Module({
  providers: [
    MemoryCatalog,
    { provide: CATALOG_READER, useExisting: MemoryCatalog },
  ],
  exports: [CATALOG_READER],
})
class CatalogModule { }

@Inject(ACCOUNT_READER, CATALOG_READER)
class OrderPreview {
  constructor(
    private readonly accounts: AccountReader,
    private readonly catalog: CatalogReader,
  ) { }

  quote(customerId: number, sku: string, quantity: number) {
    if (!this.accounts.exists(customerId)) throw new Error('Account not found');
    const product = this.catalog.find(sku);
    if (!product) throw new Error('Product not found');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) {
      throw new RangeError('Invalid quantity');
    }
    const totalMinor = product.unitMinor * quantity;
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
      throw new RangeError('Invalid total');
    }
    return { customerId, sku, currency: product.currency, totalMinor };
  }
}

@Module({
  imports: [AccountsModule, CatalogModule],
  providers: [OrderPreview],
  exports: [OrderPreview],
})
class OrdersModule { }

@Module({ imports: [OrdersModule] })
class AppModule { }

test('compiles visibility before instantiating providers', async () => {
  const before = MemoryCatalog.constructions;
  const compiled = bootstrapModule(AppModule, {
    duplicateProviderPolicy: 'throw',
  });
  try {
    assert.equal(MemoryCatalog.constructions, before);
    assert.deepEqual(compiled.modules.map((entry) => entry.type), [
      AccountsModule, CatalogModule, OrdersModule, AppModule,
    ]);
    const orders = compiled.modules.find((entry) => entry.type === OrdersModule);
    assert.ok(orders);
    assert.equal(orders.accessibleTokens.has(CATALOG_READER), true);
    assert.equal(orders.accessibleTokens.has(MemoryCatalog), false);
    assert.equal(compiled.container.has(MemoryCatalog), true);

    const preview = await compiled.container.resolve(OrderPreview);
    assert.deepEqual(preview.quote(7, 'FLUO-TEE-BLACK-M', 2), {
      customerId: 7,
      sku: 'FLUO-TEE-BLACK-M',
      currency: 'KRW',
      totalMinor: 50000,
    });
    assert.equal(MemoryCatalog.constructions, before + 1);
  } finally {
    await compiled.container.dispose();
  }
});

test('rejects hidden targets even through aliases or optional injection', () => {
  @Module({
    imports: [CatalogModule],
    providers: [{ provide: HIDDEN_ALIAS, useExisting: MemoryCatalog }],
  })
  class AliasLeakModule { }

  @Inject(Optional.create(MemoryCatalog))
  class OptionalLeak {
    constructor(readonly catalog: MemoryCatalog | undefined) { }
  }

  @Module({
    imports: [CatalogModule],
    providers: [OptionalLeak],
  })
  class OptionalLeakModule { }

  assert.throws(() => bootstrapModule(AliasLeakModule), ModuleVisibilityError);
  assert.throws(() => bootstrapModule(OptionalLeakModule), ModuleVisibilityError);
});

test('reuses compiled structure without sharing container instances', async () => {
  const cache = new ModuleGraphCompileCache(2);
  const first = bootstrapModule(AppModule, { moduleGraphCache: cache });
  try {
    const firstOrders = first.modules.find((entry) => entry.type === OrdersModule);
    assert.ok(firstOrders);
    firstOrders.accessibleTokens.clear();
    const second = bootstrapModule(AppModule, { moduleGraphCache: cache });
    try {
      assert.equal(cache.size, 1);
      const secondOrders = second.modules.find((entry) => entry.type === OrdersModule);
      assert.ok(secondOrders);
      assert.equal(secondOrders.accessibleTokens.has(CATALOG_READER), true);
      assert.notEqual(
        await first.container.resolve(OrderPreview),
        await second.container.resolve(OrderPreview),
      );
    } finally {
      await second.container.dispose();
    }
  } finally {
    await first.container.dispose();
    cache.dispose();
  }
  assert.equal(cache.size, 0);
});

test('uses the same module boundary in an application context', async () => {
  const context = await FluoFactory.createApplicationContext(AppModule, {
    duplicateProviderPolicy: 'throw',
  });
  try {
    const preview = await context.get(OrderPreview);
    assert.equal(preview.quote(7, 'FLUO-TEE-BLACK-M', 1).totalMinor, 25000);
    assert.throws(() => preview.quote(9, 'FLUO-TEE-BLACK-M', 1));
    assert.throws(() => preview.quote(7, 'UNKNOWN', 1));
    assert.throws(() => preview.quote(7, 'FLUO-TEE-BLACK-M', 0), RangeError);
  } finally {
    await context.close();
  }
});
```

The first test's `container.has(MemoryCatalog)` is a deliberate observation. Instead of creating an access-control proxy container for each module, runtime validates dependency visibility during compilation and then collects effective registrations in the root container. An internal class existing in the container is different from the order module being allowed to inject that class declaratively. Passing the container itself to a service so that it can look up hidden tokens directly steps outside the declaration graph and is not a design that preserves module boundaries.

Comparing construction counts before and after compilation matters too. `bootstrapModule()` is a low-level API that returns the graph and the container's baseline state. Providers being registered here does not mean that application initialization hooks or listener startup have finished. We verify that the product implementation is created on the first actual `resolve()`. The final test assembles the same modules into an application context without HTTP and uses the public `get()` and `close()` paths together.

## Duplicate Registration Is a Separate Decision from Visibility

Even a valid graph may contain different modules registering the same token. `selectEffectiveBootstrapProviders()` in `bootstrap.ts` selects the declarations that will actually be registered, accounting for the duplicate policy and runtime providers. The public `duplicateProviderPolicy` supports `warn`, `throw`, and `ignore`, and the current default is `warn`. This experiment explicitly uses `throw` on important assembly paths to catch accidental duplication immediately.

Choosing `warn` or `ignore` allows a path where the later declaration for a single token wins, and runtime providers in bootstrap options can replace module declarations for the same token. This is not a way to restore valid module boundaries. A duplicate policy cannot fix a missing export, nor should it be understood as choosing one singleton after all the duplicates have been created. The list of effective winners is the basis for registration and subsequent lifecycle decisions.

Plugin lists that need multiple contributions use the separate `multi: true` contract. Do not expect changing the policy to `ignore` to turn several single implementations into an array automatically. For a token that needs one authoritative implementation, such as a product price port, it is generally better to retain one owning module and explicit exports.

When adding failure scenarios, distinguish failures at different stages. Exporting a nonexistent token causes `ModuleVisibilityError`, cyclic module imports cause `ModuleGraphError`, and an invalid provider declaration causes `InvalidProviderError`. Scope mismatches or failures during provider creation can appear later during DI resolution. Alongside error types, counters or in-memory signals that check whether constructors or external resource operations have not yet run can define the failure boundary more clearly in tests.

## The Compilation Cache Is Not an Object Cache

When assembling the same module configuration repeatedly in several contexts, it can be useful to reuse module traversal and visibility calculations. `moduleGraphCache` is an explicitly enabled option. `true` uses a process-local cache that retains up to 100 successful snapshots based on recency of use. Hosts that need to manage the lifetime themselves can pass a `ModuleGraphCompileCache` instance, as in the experiment, and call `dispose()` when its owning boundary ends.

The key incorporates root module identity, runtime providers, validation tokens, module replacement pairs, the core metadata version, and the compilation algorithm version. Failed compilations are not cached as though they were successful results. The testing option `moduleReplacements` provides a boundary for reading replacement metadata while preserving the original logical module identity. Building keys solely from class names as though each replacement were a separate new application would confuse different dynamic modules with the same name.

The returned graph is an isolated copy so that it cannot contaminate later bootstraps. The third test verifies that clearing the first result's accessible token set leaves the second result intact. It also verifies that `OrderPreview` differs between the two containers. Reusing compilation results must not lead to sharing request-specific state or singleton instances across separate application lifetimes.

The level of copying must also be distinguished from DI normalization in Chapter 5. A `useValue` registered directly with DI preserved its object reference, whereas compilation cache snapshot isolation has a separate copying path for provider declarations and nested values. Do not entrust the lifetime of a live connection object to the compilation cache. Expressing creation boundaries with classes or factories and letting the container own actual instances makes graph reuse easier to separate from resource reuse.

A monolith that starts once and runs for a long time may gain little from a compilation cache. Creating a new dynamic module class every time also changes the key every time, lowering the hit rate. Before enabling the cache, examine how frequently assembly repeats and how metadata changes, and measure copying costs and retained memory as well. Claiming that one cache option automatically increases ordinary request throughput goes beyond this stage's responsibilities.

## From a Graph to a Running Application

```bash
pnpm exec tsc src/experiments/module-compilation.test.ts --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir .book-experiments
node --test .book-experiments/module-compilation.test.js
```

Run the four tests using Node24 and pnpm10. The expected results are that dependency modules are listed first, aliases and optional injections targeting a hidden store are rejected, and contexts sharing a cache still have different objects. The final context test touches no actual payment system or database. This chapter does not supply passing logs for these commands; it specifies reproduction steps derived from the current packages' public contracts, implementations, and regression tests.

The product's assembly boundary now has a readable structure. While retaining the existing account and post features, orders consume the product module's public reader token. Instead of additionally exporting the internal store or unconditionally creating a new shared module, we exposed only the contracts that actually need to be shared. In the next chapter, we initialize the providers in this valid graph and examine what must be rolled back if startup fails with only some resources ready. Successful compilation is the starting point for that work, not a signal that the application is ready.

## Source References

- [Core README: modules, globals, and explicit injection](../../packages/core/README.md), [public exports](../../packages/core/src/index.ts)
- [Decorators that record module metadata](../../packages/core/src/decorators.ts)
- [Runtime README: compilation, cache, and context contracts](../../packages/runtime/README.md), [public exports](../../packages/runtime/src/index.ts)
- [Module traversal, visibility, export validation, and cache implementation](../../packages/runtime/src/module-graph.ts)
- [Bootstrap and effective provider selection](../../packages/runtime/src/bootstrap.ts), [module and compilation result types](../../packages/runtime/src/types.ts)
- [Visibility regression tests for hidden alias targets](../../packages/runtime/src/module-graph-alias-visibility.test.ts)
- [Tests for provider validation before compilation](../../packages/runtime/src/module-graph-provider-validation.test.ts)
- [Tests for compilation caching, isolation, and metadata changes](../../packages/runtime/src/module-graph.test.ts)
- [Shared provider normalization implementation](../../packages/di/src/provider-normalization.ts)

[Previous Chapter](./ch07-scopes-and-disposal.md) | [Volume 3 Contents](./toc.md) | [Next Chapter](./ch09-bootstrap-and-rollback.md)
