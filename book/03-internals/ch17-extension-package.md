# Building a Reusable Fluo Extension Package

<!-- book:volume=03-internals;chapter=17 -->

[Previous: Building an Adapter and Verifying Its Contract](./ch16-custom-adapter.md) | [Volume 3 Contents](./toc.md) | [Next: How the CLI and Studio See an Application](./ch18-cli-and-studio.md)

## When Copied Code Becomes a Second Set of Product Rules

After adding a shop to FluoBlog, the operator began asking different questions. At first, knowing "Who published this post?" was enough. Now, for a T-shirt ordered by a reader using the same account, the operator also needs to know "Which order's payment completion was processed?" Adding a recording function to both the post publishing code and the order processing code left one using a field named `postId` and the other using `resource`. During an incident investigation, the two records could not be read with the same tool. Even after fixing the record format once, the two implementations drifted apart again.

Moving the order state machine into a shared package to solve this problem would make the extraction far too broad. A post's `draft -> published` and an order's `pending_payment -> paid` are not the same transition. What the extension should share is **a boundary for delivering events that have already been decided in a consistent shape**. Whether a transition is allowed, whether the transaction has committed, and how to identify duplicate events remain the responsibilities of the existing `PostsModule` and `OrdersModule`.

Just as the adapter built in the previous chapter had to preserve the request execution contract, this extension must preserve the DI and module contracts. An implementation that registers itself in a global container or reads environment variables as soon as the package is imported takes choices away from the user. Merely importing it in a test opens a connection, and two apps in the same process end up using the same settings. An explicit registration function is necessary not to make the API look attractive, but to return configuration and resource ownership to the application.

The name `@example/fluo-audit` in this chapter is for an extension you will write. It is not a published Fluo package in this repository, nor does it imply that a complete shop repository exists. The implementation assumes Node24, pnpm10, and the existing build configuration that handles standard decorators. Place the files in `src/index.ts` of your extension project and under `fluo-blog/src/audit/...`. `examples/fluo-blog` is evidence for the initial HTTP/DI lessons, not an executable checkpoint for this extension.

## First Define What Successful Recording Means

The recording port has just one method: `append(record): Promise<void>`. When the returned Promise fulfills, the storage operation defined by that adapter is complete. For a memory adapter, this means the record has entered an array; for a persistent adapter, it means the commit promised by that adapter has finished. In neither case does this return value alone establish atomicity with the database transaction for a post or order.

Each event carries an `eventId`, an `actorId` containing a string user ID, an entity kind, an entity ID, an event name, and a version. Post IDs remain positive integers. Order IDs are represented as strings in this experiment. A discriminated union ties the entity to its event name, preventing combinations such as `entity: 'post'` with `action: 'order.paid'` at the type level. Not accepting titles, content, passwords, tokens, or entire orders is also a design decision. Do not develop a habit of serializing entire sensitive objects while designing a record format.

The two domains start their versions differently. A new post draft has version 1, and its first publication without an intervening edit produces version 2. A new order has version 0, and its first payment completion transition produces version 1. The two events accepted here are records after a transition, so they require a positive version. Do not transfer this condition unchanged to the order creation model and prohibit version 0.

The caller supplies `eventId` as the event identifier. If the package generates a new ID on every call, retries of the same event become different events. Conversely, the memory adapter in this chapter does not reject the same ID, so it does not provide idempotency. Preserving an identifier and removing duplicates are different contracts. This distinction must also hold when a persistent Outbox redelivers the same event.

The following is the **complete `src/index.ts` file** for the extension project. It makes no external deliveries or database connections. The `sink` in `AuditOptions` is a required port; the registering application supplies both the configuration and the actual port implementation.

```ts
import {
  Inject,
  Module,
  type AsyncModuleOptions,
  type Constructor,
  type Token,
} from '@fluojs/core';
import type { Provider } from '@fluojs/di';

export type AuditEvent = {
  readonly eventId: string;
  readonly actorId: string;
  readonly version: number;
} & (
  | { readonly entity: 'post'; readonly entityId: number; readonly action: 'post.published' }
  | { readonly entity: 'order'; readonly entityId: string; readonly action: 'order.paid' }
);

export type AuditRecord = AuditEvent & { readonly source: string };

export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
}

export interface AuditOptions {
  readonly source: string;
  readonly sink: AuditSink;
}

export type AuditAsyncOptions = AsyncModuleOptions<AuditOptions> & {
  readonly imports?: Constructor[];
};

export const AUDIT_OPTIONS: Token<Readonly<AuditOptions>> =
  Symbol.for('fluo.example-audit.options');
export const AUDIT_RECORDER: Token<AuditRecorder> =
  Symbol.for('fluo.example-audit.recorder');

function normalizeOptions(options: AuditOptions): Readonly<AuditOptions> {
  if (typeof options.source !== 'string' || options.source.trim() === '') {
    throw new TypeError('Audit source must be a non-empty string.');
  }
  if (!options.sink || typeof options.sink.append !== 'function') {
    throw new TypeError('Audit sink must implement append(record).');
  }
  return Object.freeze({ source: options.source.trim(), sink: options.sink });
}

@Inject(AUDIT_OPTIONS)
export class AuditRecorder {
  constructor(private readonly options: Readonly<AuditOptions>) {}

  async record(event: AuditEvent): Promise<void> {
    if (!event.eventId || !event.actorId) {
      throw new TypeError('Audit event and actor identifiers are required.');
    }
    if (!Number.isSafeInteger(event.version) || event.version < 1) {
      throw new RangeError('Audit version must be a positive safe integer.');
    }
    if (event.entity === 'post') {
      if (!Number.isSafeInteger(event.entityId) || event.entityId < 1) {
        throw new RangeError('Post identifier must be a positive safe integer.');
      }
      if (event.action !== 'post.published') {
        throw new TypeError('Invalid post audit action.');
      }
    } else if (event.entity === 'order') {
      if (typeof event.entityId !== 'string' || event.entityId.length === 0) {
        throw new TypeError('Order identifier must be a non-empty string.');
      }
      if (event.action !== 'order.paid') {
        throw new TypeError('Invalid order audit action.');
      }
    } else {
      throw new TypeError('Unsupported audit entity.');
    }
    await this.options.sink.append(Object.freeze({
      eventId: event.eventId,
      actorId: event.actorId,
      version: event.version,
      entity: event.entity,
      entityId: event.entityId,
      action: event.action,
      source: this.options.source,
    }) as AuditRecord);
  }
}

export class AuditModule {
  static forRoot(options: AuditOptions): Constructor {
    return AuditModule.configure({
      provide: AUDIT_OPTIONS,
      useValue: normalizeOptions(options),
    });
  }

  static forRootAsync(options: AuditAsyncOptions): Constructor {
    return AuditModule.configure({
      provide: AUDIT_OPTIONS,
      inject: options.inject,
      useFactory: async (...deps: unknown[]) =>
        normalizeOptions(await options.useFactory(...deps)),
    }, options.imports);
  }

  private static configure(
    optionProvider: Provider<Readonly<AuditOptions>>,
    imports: Constructor[] = [],
  ): Constructor {
    @Module({
      imports,
      providers: [
        optionProvider,
        AuditRecorder,
        { provide: AUDIT_RECORDER, useExisting: AuditRecorder },
      ],
      exports: [AUDIT_RECORDER],
    })
    class ConfiguredAuditModule {}

    return ConfiguredAuditModule;
  }
}
```

Here, `@Inject(AUDIT_OPTIONS)` is attached to the class. TypeScript constructor parameter types are erased, so writing `Readonly<AuditOptions>` alone does not cause injection. The provider that supplies `AUDIT_OPTIONS` and the class metadata that requests that token form the actual connection. Adding a type argument to `Token<T>` does not replace runtime object validation, so options are checked at the registration boundary.

`normalizeOptions` freezes a new object instead of retaining the input object as-is. If the caller later changes `source`, the registered configuration does not change. The `sink` itself, however, is not copied. Copying a caller-owned instance could break the connection to an array observed in a test or disrupt external resource ownership. The final type assertion only narrows the loss of TypeScript's correlation between the fields of the validated discriminated union when projecting them into a new object. It is not an assertion used to trust unvalidated external JSON.

The options provider is a singleton by default, so the result of the async factory is also shared within that container. This is not a service that reads async configuration on every use. The `imports` passed to `forRootAsync` make the dependencies used by the configuration factory visible. If you discard this array and copy only `inject`, the token may be named but still unavailable in the module graph being compiled.

The class is exported from the package root, but only `AUDIT_RECORDER` appears in the module's `exports`. These exports serve different purposes. The former is a name TypeScript consumers can import; the latter is a token other Fluo modules can inject. `useExisting` gives the same instance another name rather than creating a separate `AuditRecorder`. The options token is also a public package name, but this does not grant module consumers permission to retrieve and modify the configuration.

## Let the Application Own the Connection

Static registration is `AuditModule.forRoot({ source: 'fluo-blog', sink })`. Use async registration when configuration and the sink are supplied through DI. The following is the **complete `fluo-blog/src/audit/audit.module.ts` file**. The memory sink is an experimental observation tool. Its records disappear when the process ends; it is not a real audit archive.

```ts
import { Module } from '@fluojs/core';
import {
  AUDIT_RECORDER,
  AuditModule,
  type AuditRecord,
  type AuditSink,
} from '@example/fluo-audit';

export class MemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

@Module({
  providers: [MemoryAuditSink],
  exports: [MemoryAuditSink],
})
class AuditDependenciesModule {}

const ConfiguredAuditModule = AuditModule.forRootAsync({
  imports: [AuditDependenciesModule],
  inject: [MemoryAuditSink],
  useFactory: (sink) => {
    if (!(sink instanceof MemoryAuditSink)) {
      throw new TypeError('Expected MemoryAuditSink.');
    }
    return { source: 'fluo-blog', sink };
  },
});

@Module({
  imports: [ConfiguredAuditModule],
  exports: [AUDIT_RECORDER],
})
export class ProductAuditModule {}
```

The factory's arguments are `unknown[]` under the public contract, so this example narrows them at the concrete class boundary. Static registration that constructs a production adapter directly with `new` and passes it in the options does not need this narrowing. What matters is that the library does not import a particular application's configuration service. Dependencies point from product code to the extension package, and the extension knows only the port.

Add the **same** `ProductAuditModule` to the `imports` of the existing `PostsModule` and `OrdersModule`, and declare `@Inject(AUDIT_RECORDER)` on the class responsible for delivering events. This is not a replacement that removes the existing providers, controllers, and other imports and leaves only this module. It is a partial change to the application assembly, not the complete file for either feature module.

Avoid having the two feature modules each call `AuditModule.forRoot(...)`. Each call creates a different module class, registering the same token under separate configurations. This extension's contract allows one root configuration per application. If you truly need multiple recording channels, design a separate contract that distinguishes their tokens and options; do not silence duplicate provider warnings and rely on the accidental behavior of the last registration winning.

The order processing class can now deliver an event after confirming the `paid` transition in the existing transaction. However, committing the order and immediately calling `record` inside an HTTP request means a storage failure can leave the order `paid` while the response reports failure. In a product with the Outbox from Volume 2, the Outbox consumer is therefore the appropriate caller of this port. Preserve the delivery location so that extracting the extension does not change the existing consistency boundary. This chapter does not execute real payments or external deliveries.

Keep `OrderTransitionsService.apply`, which stores the state, version, and `OrderTransition` audit record in the same transaction. Neither this extension's delivery records nor the Outbox replaces that atomic audit ledger. `OrderInventoryService.confirmPayment` combines the transition with reservation confirmation and changes `Reservation` to `consumed` without deducting `Stock.available` again after it was reduced at reservation time. The actual charge orchestration boundary is `PaymentLedger.prepare/record` in `src/payments/payment-ledger.ts`; do not create a second payment flow inside the extension.

## Separate Container Experiments from Module Experiments

The following is the **complete `src/audit.test.ts` file** for the extension project. Run it with Vitest configured to transform standard decorators. The plain Container experiment verifies token and alias identity and failure propagation. The module experiment verifies the `imports/providers/exports` connections. Passing one does not prove the other boundary.

```ts
import { Inject, Module } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { createTestingModule } from '@fluojs/testing';
import { expect, it } from 'vitest';
import {
  AUDIT_OPTIONS,
  AUDIT_RECORDER,
  AuditModule,
  AuditRecorder,
  type AuditEvent,
  type AuditRecord,
} from './index.js';

const event: AuditEvent = {
  eventId: 'post:1:published:2',
  actorId: 'reader-7',
  entity: 'post',
  entityId: 1,
  action: 'post.published',
  version: 2,
};

it('shares the recorder alias and propagates sink failure', async () => {
  const failure = new Error('sink unavailable');
  const container = new Container().register(
    { provide: AUDIT_OPTIONS, useValue: {
      source: 'fluo-blog',
      sink: { append: async () => { throw failure; } },
    } },
    AuditRecorder,
    { provide: AUDIT_RECORDER, useExisting: AuditRecorder },
  );
  try {
    const recorder = await container.resolve<AuditRecorder>(AUDIT_RECORDER);
    expect(recorder).toBe(await container.resolve(AuditRecorder));
    await expect(recorder.record(event)).rejects.toBe(failure);
  } finally {
    await container.dispose();
  }
});

it('exports the configured recorder into a consuming module', async () => {
  const records: AuditRecord[] = [];
  let factoryCalls = 0;
  const extension = AuditModule.forRootAsync({
    useFactory: () => {
      factoryCalls += 1;
      return {
        source: 'fluo-blog',
        sink: { append: async (record) => { records.push(record); } },
      };
    },
  });
  @Inject(AUDIT_RECORDER)
  class Probe {
    constructor(readonly recorder: AuditRecorder) {}
  }
  @Module({ imports: [extension], providers: [Probe] })
  class ProbeModule {}

  const module = await createTestingModule({ rootModule: ProbeModule }).compile();
  try {
    const probe = await module.resolve(Probe);
    await Promise.all([probe.recorder.record(event), probe.recorder.record(event)]);
    expect(factoryCalls).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ ...event, source: 'fluo-blog' });
    expect(Object.isFrozen(records[0])).toBe(true);
  } finally {
    await module.container.dispose();
  }
});
```

The expectation of two records in the second test is deliberate. Do not write a regression test claiming there is only one when deduplication has not been implemented. Even if a response is lost immediately after the sink succeeds and the operation is retried, this memory implementation appends twice. If a persistent adapter is later made to enforce `eventId` uniqueness, define duplicate and conflict outcomes separately in that adapter's contract tests.

Additional failure experiments should also have clear causes. Changing `source` to an empty string should cause a `TypeError` before `forRoot` returns a module. If an async factory returns the same options, compilation should reject. Removing the extension import from `ProbeModule` or changing the extension's `exports` to an empty array should fail token visibility validation. Also checking that the sink call count is 0 distinguishes an implementation that discovers wiring errors only after making the actual call.

The sink in this experiment opens no resources, so it has no shutdown hook. If you later introduce an implementation with a file handle or connection, let the provider that created the connection own `onDestroy`. The recorder must not arbitrarily close an externally supplied object. Container disposal can retry failed hooks on an explicit subsequent call, so a real adapter must be safe to retry after partial shutdown. This is a lifecycle contract separate from the retry policy for `record`.

## Boundaries to Preserve When Shipping a Package

For `src/index.ts` to be an honest public surface, the distribution must contain the same exports and declarations. Do not tell consumers to import `@example/fluo-audit/src/...`. Produce ESM JavaScript and `.d.ts` files and connect the root of the package export map to those outputs. Declare only Fluo version ranges for combinations you have actually verified. Using standard decorators in the source does not mean Node24 executes all TypeScript decorators without transformation.

The package README should describe static registration, DI-based registration, the required sink port, one root configuration per app, failure propagation, and the limits of the nonpersistent memory example together. Add TSDoc for the publicly distributed API as well. The files in this chapter are complete source files explaining the runtime implementation, not a publishable tarball with version selection and build configuration already settled. Proceed with actual distribution only after verifying a test that imports the public entry point from a consumer project.

`forRoot` and `forRootAsync` are not decorative conventions. The extension contract requires explicit entry points, typed options and tokens, no import-time side effects, and normalization or sharing of resolved async options. If the configuration shape or failure semantics change, update the tests, documentation, and versioning policy along with the code. The final chapter covers Changesets and release boundaries for contributions to first-party `@fluojs/*` packages.

A short function used twice within one service does not need to become an npm package immediately. You can leave it as a module under `src/audit` and observe the differences another app actually needs. Conversely, a package boundary becomes useful if the same event format and registration contract must also hold in a separate fulfillment process. The criterion for extraction is not the number of lines, but whether there is a contract that can be explained and verified independently.

The same blog and shop now share a record format while leaving domain decisions and storage responsibilities at their respective boundaries. The next chapter examines how these registered tokens and modules appear in tooling. We will distinguish whether a line in a diagram means a real request executed along that line, and whether a static report can explain even a failed bootstrap.

## Source References and Verification Scope

- [core README](../../packages/core/README.md), [public exports](../../packages/core/src/index.ts), [decorator implementation](../../packages/core/src/decorators.ts): class-level injection and module metadata.
- [DI README](../../packages/di/README.md), [public provider types](../../packages/di/src/types.ts), [Container implementation](../../packages/di/src/container.ts): registration, aliases, singletons, and disposal ownership.
- [Extension contract](../../docs/contracts/third-party-extension-contract.md): options, tokens, registration entry points, and environment isolation.
- [testing README](../../packages/testing/README.md), [module testing implementation](../../packages/testing/src/module.ts), [testing contract](../../docs/contracts/testing-guide.md): verification through a real module graph.
- [DI shutdown retry tests](../../packages/di/src/container-disposal-retry.test.ts): the shutdown contract, which must be distinguished from recording retries.

The expected results of the example tests are reproduction criteria based on the contracts above. They are not presented as results from creating a new extension project or running its tests for this manuscript. Persistent recording, deduplication, and Outbox integration are not verified by this memory experiment.
