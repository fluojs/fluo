# Where Is Metadata Stored?

<!-- book:volume=03-internals;chapter=03 -->

[Previous: Standard Decorators and the Role of Build Tools](./ch02-standard-decorators.md) | [Volume 3 Contents](./toc.md) | [Next: Building Custom Decorators Safely](./ch04-custom-decorators.md)

## Changing the Order Page Settings Changed Another Application Too

The operator wanted to experiment with the explanatory label on the blog's order history page. In a test, they registered a configuration provider for the orders module and called `getModuleMetadata()`. Applying `Object.isFrozen()` to the return value produced `true`, so they assumed the configuration object was now completely immutable. But when another test used the same `useValue` object, changing the label in one test was visible in another application instance too.

This cannot be explained simply by saying "metadata is global." We need to separate what is shared globally, which object is the key, and how far copying and freezing extend. A frozen module descriptor and the live configuration object it points to have different ownership. `Symbol.metadata`, which we examined in the previous chapter, is not a single drawer containing all of Fluo's metadata either.

This chapter studies the orders module in the same FluoBlog and FluoShop application. We investigate the lifetime of module declarations and order lookup settings without creating new account or order schemas. Our starting point is to avoid confusing the product's PostgreSQL data with metadata storage. Metadata contains which providers to register and which tokens to inject. A particular customer's order status and payment result are application data. Finding the former does not guarantee persistence or isolation for the latter.

## Distinguishing Two Storage Paths

In core's `src/metadata/shared.ts`, `getGlobalMetadataWeakMap()` retrieves framework-owned storage. This function finds and reuses a named WeakMap from the registry under `Symbol.for('fluo.metadata.registry')` on `globalThis`. The registry holds WeakMaps for each metadata kind and version counters. `module.ts` uses module class functions as keys, while `class-di.ts` uses the class functions targeted by DI. Some method and field information is stored using both an owning object and a property key.

Here, "global" means package instances can share the storage within the same JavaScript global environment in the same process. It does not mean data is replicated between separate Node processes or worker isolates. Class name strings are not used as keys either. Evaluating `class OrdersModule {}` twice produces different function objects, even though their names match. The same function must be supplied to retrieve the same record. This distinction is particularly important for understanding hot reload and test module resets.

The other path is a standard decorator's `context.metadata`. A transformed class declaration connects its metadata bag to the class's metadata symbol property. Fluo's helpers account for the current `Symbol.metadata` and the fallback symbol `Symbol.for('fluo.symbol.metadata')`. Built-in module and DI decorators writing directly to storage and other decorators writing to the standard bag are related but not identical operations. Therefore, opening the class's symbol property and finding no `imports` there does not by itself mean that `@Module` failed.

The usual application entry points are `Module`, `Inject`, `Scope`, `ensureMetadataSymbol`, and `getModuleMetadata` from the root export. Broader readers and writers live in `@fluojs/core/internal` for implementation integration between sibling framework packages. Standard bag and DTO helpers for the request pipeline have a separate documented boundary at `@fluojs/core/request-pipeline`. Do not pull writers that are not exported from the root into application convenience functions to modify a currently running application.

## An Experiment Separating Snapshots from Actual Configuration Objects

The following `src/metadata-lab.ts` is a **complete, isolated experiment file**. `OrderViewOptions` contains display settings for the order lookup page, and `ORDER_VIEW_OPTIONS` is the actual token used to inject those settings. It has no role in order state transitions or monetary calculations. Because we are testing the act of changing configuration, only the object in this file is deliberately left mutable.

```ts
import assert from 'node:assert/strict';
import { Inject, Module, getModuleMetadata } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

interface OrderViewOptions {
  label: string;
}

const ORDER_VIEW_OPTIONS = Symbol('ORDER_VIEW_OPTIONS');
const options: OrderViewOptions = { label: 'Order summary' };
const descriptor = {
  provide: ORDER_VIEW_OPTIONS,
  useValue: options,
};

@Inject(ORDER_VIEW_OPTIONS)
class OrdersService {
  constructor(private readonly view: OrderViewOptions) { }

  labelFor(id: string) {
    return `${this.view.label}: ${id}`;
  }
}

const declarations = [descriptor, OrdersService];

@Module({
  providers: declarations,
  exports: [OrdersService],
})
class OrdersModule { }

class ChildOrdersModule extends OrdersModule { }

const snapshot = getModuleMetadata(OrdersModule);
assert.ok(snapshot);
assert.equal(getModuleMetadata(OrdersModule), snapshot);
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(Object.isFrozen(snapshot.providers), true);

const stored = snapshot.providers?.[0];
assert.ok(typeof stored === 'object' && stored !== null);
assert.ok('useValue' in stored);
assert.equal(Object.isFrozen(stored), true);
assert.equal(stored.useValue, options);
assert.equal(Object.isFrozen(options), false);

declarations.length = 0;
descriptor.useValue = { label: 'Replacement descriptor' };
assert.equal(snapshot.providers?.length, 2);
assert.equal(stored.useValue, options);
assert.equal(getModuleMetadata(ChildOrdersModule), undefined);

const app = await FluoFactory.createApplicationContext(OrdersModule);
try {
  const orders = await app.get(OrdersService);
  assert.equal(orders.labelFor('order-1001'), 'Order summary: order-1001');
  options.label = 'Updated summary';
  assert.equal(orders.labelFor('order-1001'), 'Updated summary: order-1001');
  assert.equal(getModuleMetadata(OrdersModule), snapshot);
  console.log('metadata ownership assertions passed');
} finally {
  await app.close();
}
```

Build the experiment file in the same way as the dedicated Vite configuration from the previous chapter, but use a separate configuration with `build.ssr` changed to `src/metadata-lab.ts` and `outDir` changed to `.lab-dist/metadata`. Since this file uses only built-in core decorators, its module and DI records do not depend on a custom `context.metadata` writer. The expected output is `metadata ownership assertions passed`. This states the assertions readers should check when running it, not a guarantee in advance of execution results in other environments.

Two providers remain after the array is emptied because `defineModuleMetadata()` does not retain the input collection as-is. It copies provider descriptors too, so replacing the original descriptor's `useValue` field with another object does not change the snapshot. But the original `options` reference inside the copied descriptor is preserved. Under the current contract, modifying `options.label` is visible to the service that actually received it through injection.

Why is this exception necessary? `useValue` can hold not only ordinary settings but also adapters, clients, and stateful objects already created by consumers. Deep-copying them would sever relationships involving method identity, internal handles, and references held elsewhere. Protecting a provider's outer structure is different from taking over the lifetime of the consumer's object. The snapshot protects declarations from accidental modification, while resources supplied by the user retain their reference semantics.

For genuinely fixed settings, the application can freeze the value before passing it, as in `Object.freeze({ label: 'Order summary' })`. If there are nested objects, define how deeply immutability must extend. If live configuration updates are required, a live reference may instead be intentional, but a separate service must own update atomicity, validation, and versioning. Do not expect the module metadata version to detect every change inside a configuration object.

## Metadata Readers Do Not All Follow the Same Policy

`getModuleMetadata()` returns the currently recorded frozen snapshot. Repeated reads of the same record reuse the same reference. Changes to input arrays do not affect it, and a new partial write stores a new snapshot. Previously returned snapshots are not updated later. The manuscript's experiment observes repeated reads and input separation through the public API.

Controller and route readers, by contrast, return copies of nested arrays and mutable values such as headers and redirects. Changing a header value from one route read must not contaminate the next read. This difference is a defensive boundary suited to consumption patterns, not an implementation accident. Frequently read declarations such as DI and module graph metadata reuse frozen snapshots to reduce allocations, while route data that will be composed is supplied as reader-returned copies.

Do not establish a universal rule that every metadata helper's return value is "safe to modify" or "always deeply frozen." A module provider's `inject` array is copied and frozen along with the descriptor, but the live object in `useValue` is retained. Middleware route wrappers and routes arrays are protected, while middleware instances themselves are preserved as-is. The reference identity and mutation tests in `metadata.test.ts` show these specific differences.

In our product, a diagnostic tool might read OrdersModule's providers and turn them into a list for people to inspect. If it needs to sort providers during that process, it should project them into a new array rather than call `sort()` on the returned array. Going further and serializing a live `useValue` to JSON for a diagnostic document can expose credentials or large client state. The name "read-only metadata" does not mean the values underneath it are safe to disclose. Tools should select only the facts they need, such as names and tokens.

## Inheritance Raises Three Different Questions

The experiment's `ChildOrdersModule` extends its parent, but `getModuleMetadata()` returns `undefined` for it. The module reader looks up the supplied class itself in the WeakMap; it does not follow the prototype chain and copy the parent module. To reuse the parent's providers, compose modules with explicit `imports` and `exports`. Using JavaScript inheritance as shorthand for module composition does not match current behavior.

Class DI is different. `getInheritedClassDiMetadata()` in `class-di.ts` walks the constructor lineage from parent to child, composing `inject` and `scope` separately. A child that declares only `@Scope('request')` can retain its parent's constructor tokens. A child declaring `@Inject()` explicitly records an empty array, clearing the parent's tokens. "No record" and "an empty list" mean different things.

The following `src/metadata-lineage.mjs` is a **complete source experiment for understanding the owning package's readers and writers**. Normal application registration uses public decorators, as in the preceding example. We call internal functions directly only in this file to observe inheritance cache inputs and outputs precisely, separately from decorator transformation. The experiment records only its own classes and does not delete framework-global settings.

```js
import assert from 'node:assert/strict';
import {
  defineClassDiMetadata,
  getClassDiMetadataVersion,
  getInheritedClassDiMetadata,
  getOwnClassDiMetadata,
} from '@fluojs/core/internal';

const ORDER_LOOKUP = Symbol('ORDER_LOOKUP');
class BaseOrdersReader {}
class RequestOrdersReader extends BaseOrdersReader {}

defineClassDiMetadata(BaseOrdersReader, {
  inject: [ORDER_LOOKUP],
  scope: 'singleton',
});
defineClassDiMetadata(RequestOrdersReader, { scope: 'request' });

assert.equal(getOwnClassDiMetadata(RequestOrdersReader)?.inject, undefined);
const inherited = getInheritedClassDiMetadata(RequestOrdersReader);
assert.deepEqual(inherited?.inject, [ORDER_LOOKUP]);
assert.equal(inherited?.scope, 'request');
assert.equal(getInheritedClassDiMetadata(RequestOrdersReader), inherited);

const before = getClassDiMetadataVersion();
defineClassDiMetadata(RequestOrdersReader, { inject: [] });
assert.equal(getClassDiMetadataVersion(), before + 1);
assert.deepEqual(getInheritedClassDiMetadata(RequestOrdersReader)?.inject, []);
assert.equal(getInheritedClassDiMetadata(RequestOrdersReader)?.scope, 'request');
assert.deepEqual(inherited?.inject, [ORDER_LOOKUP]);
console.log('metadata lineage assertions passed');
```

```bash
node src/metadata-lineage.mjs
```

This experiment shows that the cache does not simply use a class function as a key and return an old value forever. Each class DI write increments a shared counter, and the inherited-result cache compares the version at which it was recorded with the current version. It rereads the lineage when necessary. This is a relatively broad invalidation strategy: even a change to one class may cause another class's inheritance cache to be recomputed. It can be read as choosing simple correctness over the cost of maintaining a fine-grained dependency graph.

The third question concerns inheritance of the standard metadata bag. This differs both from module WeakMap inheritance and from DI's field-by-field composition. The helper considers the own current/native bag, the own fallback-era bag, and inherited bags in that order. If a child has an own key from either era, it takes precedence over the parent's record for that key. If the child has only other keys, the parent's value for the key can still be found. When the same class has both native and fallback bags, the native bag is selected first; this is not an algorithm that arbitrarily deep-merges every key from both bags.

Seeing an inherited key during a read therefore does not mean it is safe to modify directly. If an array retrieved from the standard bag belongs to the parent, a single `push()` can affect the parent and sibling classes. This is why the next chapter's custom decorator checks ownership and copies before writing. The convenience of inheritance through property lookup makes explicit ownership all the more important for writers.

## The Global Registry and Class Lifetimes

WeakMap is used so that metadata records alone do not hold class objects strongly. But "it uses WeakMap, so there are no memory leaks" is not a valid conclusion. If a compiled module graph, DI container, or global application reference retains the same class, the class remains alive. A WeakMap's weak key does not cancel strong references elsewhere.

The same distinction matters when packages are loaded more than once. `metadata.test.ts` checks whether a metadata implementation reimported after a module reset can read previously recorded data for the same class. The registry and `Symbol.for` boundary support this. But reevaluating the application source itself to create a new `OrdersService` function produces a different key from the previous class. Merging metadata merely because class names or source strings match would instead mix declarations from separate tests and applications.

`Symbol.for` is not a way for all processes to communicate just by agreeing on a name. It obtains the same key from the same global symbol registry. Storing an order idempotency key there would leave it lost on process restart or separated across instances. Preventing duplicate orders is the responsibility of the persistent store from Volume 2. The symbols in this chapter identify framework declarations and avoid collisions; they are not a business-key store for merchandise orders.

Avoid deleting the global registry to achieve test isolation too. If WeakMap references already obtained by other packages differ from the references obtained by later readers, tests can create failures that do not reflect real use. Creating fresh test classes and application contexts, then closing those contexts, better preserves ownership boundaries. Do not assert that GC must happen within a particular time either. Trying to verify WeakMap behavior with a fixed sleep produces a test that passes by chance depending on the collector's schedule.

## Deciding Whether an Order Failure Is a Metadata Problem

If a new provider is not visible in production, first compare the declaration's key with the bootstrap target. Is the OrdersModule read by the tool the same function as the OrdersModule in the actual imports? Was only the metadata changed after the application had already bootstrapped? Was an exception ignored while attempting to modify an array in a read-only snapshot? These questions get closer to the cause than merely printing whether the registry exists.

If settings leak between tests, check whether `useValue` is the same object. In the earlier experiment, creating two contexts from the same OrdersModule lets both see the explicitly shared `options` object regardless of container independence. Separating containers does not copy external values. Create a new settings object and module declaration for each test, or apply an immutability contract if the value is intentionally shared.

When suspecting a cache problem, also check what increments the version. Writes through `defineModuleMetadata()` and `defineClassDiMetadata()` update counters. Changing a string inside `useValue` is not the same kind of write. Adding meaningless decorator calls to invalidate the cache is not a solution. If configuration must change while running, design an explicit runtime API and ownership for that capability.

The related regressions are collected in `module-defaults.test.ts`, `metadata.test.ts`, and `metadata-precedence.test.ts`. The following command checks only those boundaries; passing it does not establish state isolation across the entire shop. In particular, the metadata version is an entirely different counter from an order's `version` field.

```bash
pnpm --filter @fluojs/core exec vitest run -c vitest.config.ts src/module-defaults.test.ts src/metadata.test.ts src/metadata-precedence.test.ts
```

We can now read metadata as declaration storage with distinct copying, inheritance, and lifetime rules rather than as a simple global object. The next chapter applies this knowledge from a writer's perspective. We add a custom decorator to order operations without contaminating parent metadata, preserve method return values and failures, and explicitly connect a consumer that actually reads the declarations.

## Source and Contract References

- [core README](../../packages/core/README.md), [Root public exports](../../packages/core/src/index.ts), [Request-pipeline integration seam](../../packages/core/src/request-pipeline.ts)
- [Global WeakMaps, counters, and standard metadata lookup](../../packages/core/src/metadata/shared.ts), [Module snapshots and useValue handling](../../packages/core/src/metadata/module.ts)
- [Class DI inheritance, caching, and versions](../../packages/core/src/metadata/class-di.ts), [Copying in controller and route readers](../../packages/core/src/metadata/controller-route.ts)
- [Reference identity, duplicate loading, and mutation defense tests](../../packages/core/src/metadata.test.ts), [Empty Module and partial write tests](../../packages/core/src/module-defaults.test.ts), [Native and fallback precedence tests](../../packages/core/src/metadata-precedence.test.ts)
- [Public and internal export boundary tests](../../packages/core/src/public-api.test.ts), [Runtime compilation cache contract](../../packages/runtime/README.md)
