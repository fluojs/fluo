# Application Startup and Failure Recovery

<!-- book:volume=03-internals;chapter=09 -->

[Previous: Compiling the Module Graph](./ch08-module-compilation.md) - [Volume 3 Contents](./toc.md) - [Next: Dissecting the HTTP Request Pipeline](./ch10-http-pipeline.md)

## Failure Can Happen Before the First Order

It is launch day for the shop added to FluoBlog. The existing account and post features work normally, and you start `CatalogModule` and `OrdersModule` in the same application with new settings. The data for product queries has been loaded into memory, but the order feature fails its readiness check. It is tempting to think no harm has been done because the server port has not opened yet. Yet connections, subscriptions, and file handles created during preparation can remain alive independently of that port. Even a single timer left behind after startup failure can contaminate the next run's logs and prevent the process from exiting.

The module graph examined in the previous chapter solves only the first half of this problem. Verifying which modules can see which tokens is different from having the actual instances behind those tokens finish initialization. A valid graph does not prevent a constructor from failing; successful construction does not prevent an initialization hook from failing; successful hooks do not guarantee that a listener can open. This chapter does not collapse these distinct failures into one generic "server startup failure."

Recovery here does not mean compensation that restores an already paid order to an earlier state. It means disposing of resources acquired while this process was starting and preserving the original error for the caller. PostgreSQL and the application rules from Volume 2 remain authoritative for product information and order data. Expecting runtime rollback to rewind database transactions or external operations gets the scope of recovery wrong from the outset.

## Separating Construction, Initialization, Readiness, and Listening

The starting point in `packages/runtime/src/bootstrap.ts` is `FluoFactory.create()`. It first compiles the modules and creates the container. It then wires up runtime tokens for the adapter, platform shell, and runtime cleanup registration. These tokens are not global variables that an application can imitate at will. They are dependencies supplied by bootstrap so that runtime integration code can access them at defined points.

Next, `resolveLifecycleInstances()` resolves the instances to initialize. Independent singleton providers are resolved using `Promise.allSettled()`. The important point is that this parallelism does not randomize hook execution order. After collecting resolution results in the declared provider order, `runBootstrapHooks()` makes two passes. The first awaits every `onModuleInit()`; only if all succeed does the next pass await `onApplicationBootstrap()`.

With two providers, the normal sequence is therefore A's init, B's init, A's bootstrap, then B's bootstrap. It does not finish A's bootstrap immediately after A's init before moving to B. This gives us a reason to put product query data preparation in that resource's init, and checks that require several modules to be ready in application bootstrap. Do not use this ordering to hide undeclared dependencies, however. If order initialization needs a catalog resource, make that relationship explicit through constructor tokens and module exports.

Each eligible singleton `multi: true` contribution is also an independent lifecycle instance. Sharing a token does not mean that only one contribution is initialized. Conversely, treating a request or transient provider as a shared resource at application startup gets its lifetime wrong. An optimization that creates a per-request transaction context in advance and shares it across every order is a scope violation, not an initialization ordering problem.

Once the hooks finish, `platformShell.start()` runs and the readiness marker is raised. The HTTP dispatcher is created after this bootstrap lifecycle. The public state of the `Application` returned at this point is `bootstrapped`. The `app.listen()` call that starts receiving traffic is separate: it checks critical readiness, then awaits `adapter.listen(dispatcher)`. The public state becomes `ready` only when the adapter succeeds. "Modules initialized," "platform ready," and "listening on the port" should remain distinct events in the logs as well.

For work that does not need HTTP, use `FluoFactory.createApplicationContext()`. An administrative job that checks post slugs, for example, needs only the container and lifecycle. Creating an HTTP application without an adapter and expecting `listen()` to do nothing does not match the current contract. Asking it to listen without an adapter produces an error.

## A Small Startup Experiment That Fails on Purpose

The following is a **complete experiment file** that can go in `src/orders/bootstrap-lab.ts` in the reader-created `fluo-blog` application. It is not a production implementation replacing the existing orders module; it reproduces an in-memory failure while preparing the shop's query data. It does not connect to an external database, payment provider, or email service. Use the existing Node24 and pnpm10 application toolchain that compiles standard decorators.

In this experiment, `CatalogSnapshot` owns a small resource, and `OrdersStartup` checks whether that resource is ready. The event array and failure switch are also injected through actual tokens. We do not assume that writing an interface type in a constructor is enough to make injection work.

```ts
import assert from 'node:assert/strict';
import { Inject, Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

const EVENTS = Symbol('BOOTSTRAP_EVENTS');
const FAIL_START = Symbol('FAIL_START');

@Inject(EVENTS)
class CatalogSnapshot {
  private items: Map<string, number> | undefined;

  constructor(private readonly events: string[]) { }

  onModuleInit(): void {
    this.items = new Map([['logo-shirt', 25_000]]);
    this.events.push('catalog:init');
  }

  priceOf(sku: string): number {
    const price = this.items?.get(sku);
    if (price === undefined) {
      throw new Error('Catalog snapshot is not ready.');
    }
    return price;
  }

  onApplicationBootstrap(): void {
    this.events.push('catalog:bootstrap');
  }

  onModuleDestroy(): void {
    this.items = undefined;
    this.events.push('catalog:destroy');
  }

  onApplicationShutdown(signal?: string): void {
    this.events.push(`catalog:shutdown:${signal ?? 'none'}`);
  }
}

@Inject(CatalogSnapshot, EVENTS, FAIL_START)
class OrdersStartup {
  constructor(
    private readonly catalog: CatalogSnapshot,
    private readonly events: string[],
    private readonly failStart: boolean,
  ) { }

  onModuleInit(): void {
    this.events.push('orders:init');
    assert.equal(this.catalog.priceOf('logo-shirt'), 25_000);
    if (this.failStart) {
      throw new Error('Order readiness failed.');
    }
  }

  onApplicationBootstrap(): void {
    this.events.push('orders:bootstrap');
  }

  onModuleDestroy(): void {
    this.events.push('orders:destroy');
  }

  onApplicationShutdown(signal?: string): void {
    this.events.push(`orders:shutdown:${signal ?? 'none'}`);
  }
}

export async function runBootstrapLab(failStart: boolean): Promise<string[]> {
  const events: string[] = [];

  @Module({
    providers: [
      { provide: EVENTS, useValue: events },
      { provide: FAIL_START, useValue: failStart },
      CatalogSnapshot,
      OrdersStartup,
    ],
  })
  class OrdersModule { }

  @Module({ imports: [OrdersModule] })
  class AppModule { }

  if (failStart) {
    await assert.rejects(
      FluoFactory.createApplicationContext(AppModule),
      { message: 'Order readiness failed.' },
    );
  } else {
    const app = await FluoFactory.createApplicationContext(AppModule);
    await app.close('lab-complete');
    await app.close('lab-complete');
  }

  return events;
}
```

Putting both resources in one module keeps the ordering experiment small. When moving `CatalogSnapshot` into the real product's `CatalogModule`, add it to that module's providers and exports, and add `CatalogModule` to `OrdersModule.imports`. The event array is an experimental instrument, not an order audit log store. Do not carry it into a production design in which multiple requests share this array.

`CatalogSnapshot.onModuleDestroy()` is safe even when preparation has not completed. Clearing a reference is enough here, but a real client must check whether it acquired a connection and close only that connection. This is also why the constructor is limited to retaining dependencies. If a constructor creates a resource and immediately throws, the runtime may never obtain a completed instance. Dispose of such partially acquired resources with `try/finally` inside the constructor or factory, or move acquisition to an explicit initialization phase where the instance already exists.

Place the experiment invocation in the following **complete test file**, `src/orders/bootstrap-lab.test.ts`. The tests use neither wall-clock time nor fixed delays. Settlement of the bootstrap promise itself is the observation point for completed disposal.

```ts
import { expect, it } from 'vitest';
import { runBootstrapLab } from './bootstrap-lab.js';

it('cleans resolved instances after startup failure', async () => {
  expect(await runBootstrapLab(true)).toEqual([
    'catalog:init',
    'orders:init',
    'orders:destroy',
    'catalog:destroy',
    'orders:shutdown:bootstrap-failed',
    'catalog:shutdown:bootstrap-failed',
  ]);
});

it('closes a successful context only once', async () => {
  expect(await runBootstrapLab(false)).toEqual([
    'catalog:init',
    'orders:init',
    'catalog:bootstrap',
    'orders:bootstrap',
    'orders:destroy',
    'catalog:destroy',
    'orders:shutdown:lab-complete',
    'catalog:shutdown:lab-complete',
  ]);
});
```

```bash
pnpm exec vitest run src/orders/bootstrap-lab.test.ts
```

The command above is a reproduction procedure to run in your application, not a claim that the new experiment files were created and executed while writing this chapter. Pay particular attention to three facts in the expected results: the failed `OrdersStartup` is also subject to destroy, the bootstrap phase never starts, and calling close twice does not repeat a successful shutdown. The error message check is not intended to pin product wording; it is an experimental instrument for checking that the deliberately introduced startup error was not replaced by a cleanup error.

## Rollback Is Not Just the Successful Init List in Reverse

In the source, `runBootstrapFailureCleanup()` lowers readiness, runs runtime cleanup callbacks, calls shutdown hooks on the instances resolved so far with `bootstrap-failed`, and then disposes of the container. This is not limited to "instances whose init succeeded." During parallel provider resolution, an instance that has already been constructed may need disposal even if another provider fails. This is why partially initialized objects must support shutdown.

Destroy and application shutdown are not grouped by instance either. All `onModuleDestroy()` hooks run in reverse lifecycle instance order, followed by all `onApplicationShutdown(signal?)` hooks, again in reverse order. You can therefore reason about when an upstream dependency and its downstream consumer are alive, but you cannot assume every connection is still open during application shutdown. Adding a late audit transmission that accesses a resource already closed during module destroy can itself cause shutdown to fail.

Errors in cleanup do not overwrite the original bootstrap error. For example, if order preparation fails and then catalog data disposal also fails, the caller receives the order preparation failure, while the disposal failure is reported separately through `ApplicationLogger`. Looking only at the first error in production can hide leftover resources; looking only at the last can hide the cause of startup failure. Correlate both records with the same execution identifier, but do not include passwords, raw tokens, or the entire order payload.

This guarantee is not a promise to cancel arbitrary external effects either. If initialization stored product discount information in the database, clearing a Map does not undo that change. Put work with clear ownership in bootstrap, such as checking connections, preparing local data, and registering subscriptions. Design repeatable data changes as separate administrative operations with an idempotency policy. Putting payments or dispatching shipments in startup hooks and running their opposite operation on failure confuses runtime resource disposal with business compensation.

## Shutdown Retries and Startup Races Have Different Contracts

Understanding normal `app.close()` is also necessary to interpret startup failure correctly. Close first shuts the terminal gate that admits new work. The public state does not immediately become `closed`. While teardown is in progress or has failed, the previous `bootstrapped` or `ready` state remains; it becomes `closed` only after success. Code that checks only `app.state === 'ready'` before submitting new work during shutdown can therefore be wrong.

Concurrent close calls share one in-progress operation. After shutdown succeeds, a subsequent close does not dispose of any resources again. If shutdown fails, explicitly calling close again can retry incomplete phases. Do not broaden this into "a retry executes every individual callback exactly once," though. Where completion is tracked by phase, work already executed within a failed phase may be called again. Application-owned hooks must be safe under repeated close calls.

Overlapping calls to HTTP `Application.listen()` share the startup in progress, and close waits for that startup to settle. A startup racing with close cannot later change the public state back to `ready`. By contrast, overlapping calls to the low-level `RuntimePlatformShell.start()` and `stop()` are rejected immediately with `PlatformLifecycleConflictError`. Although the verbs look similar, the public application facade and the platform transition engine have different concurrency contracts.

There is no need to hide this distinction behind your own infinite retry queue in product code. Let a single execution boundary in `src/main.ts` own startup and shutdown. If independent administrative code tries to restart the same resource, check whether the current operation has finished and reassess the intended state. Create a new application when necessary rather than reopening the terminal gate of a failed one. Repeatedly calling `listen()` on the same object after disposal fails is not recovery.

## Hooks That Run Before the Listener Closes

Consider a rolling replacement while the shop is taking orders. The assumption "we closed the order database connection in destroy, so all requests must have finished" does not match the current order. Normal runtime close proceeds through readiness reset, runtime cleanup, shutdown hooks, `adapter.close(signal)`, and container disposal. Any connected child microservices close before these parent phases. A lifecycle hook is not an event announcing that listener close or the draining of every connection has completed.

A hook-owned resource must therefore also define how it handles incoming work and finishes work already in progress. The dispatcher and adapter remain responsible for handling HTTP requests that have already entered. The runtime blocking new direct `Application.dispatch()` calls and the disposal of connections arriving through actual sockets are separate boundaries. This distinction leads into request cancellation in Chapter 12 and the Node adapter comparison in Chapter 13.

Process signals are not an implicit responsibility of the portable runtime either. When using a Node host helper, check that helper's signal registration contract; merely calling `FluoFactory.create()` does not wire up all `SIGTERM` handling. Because we chose a context experiment without a listener, we do not verify process signals or drain here. Do not supplement the meaning of the four lifecycle hooks with a name remembered from another framework, such as `beforeApplicationShutdown`. That hook is not part of Fluo's public lifecycle contract.

## Breaking Production Failures into Tests

When extending the experiment to the real shop, observations at each failure point matter more than a single success path. If a provider factory fails, check that other resources that finished construction are disposed of. A failure partway through `onModuleInit()` must occur without the bootstrap phase having been called yet. If `onApplicationBootstrap()` fails, data initialized earlier must not remain. Do not treat a listener bind failure as equivalent to a `create()` failure; check who calls close on the application that has already been returned.

In a cleanup failure experiment, do not merely expect a rejection. Observe separately whether later resources were also disposed of, whether the original startup error was preserved for the caller, and whether the logger recorded the disposal error. For a shutdown retry experiment, make only a particular resource fail on the first close and recover on the second. Checking that `get()` or new dispatches are rejected in between can catch a regression in which "disposal failed, so the service reopened."

Write race experiments with promises that directly control listener entry and release. Subscribe to the startup entry event first, call `listen()`, confirm entry, and then call close. Finally, invoke the release function prepared earlier. Unlike waiting for an interval and then reading state, this creates precisely the state of shutdown during startup. The repository's `application.test.ts` and `bootstrap.test.ts` provide evidence to read when checking these shutdown and retry contracts.

What this chapter provides is not a special bootstrap manager class. It is a way to distinguish resource ownership, the point at which initialization completes, work left after failure, and the relationship between the original error and cleanup errors. The shop is still the same application with the same accounts and posts; there is no need to move every feature into a separate process. In the next chapter, we trace the actual order of declared middleware, guards, and interceptors when an order query enters a successfully prepared application.

## Sources and Verification Evidence

- [Runtime README and public API](../../packages/runtime/README.md), [root export](../../packages/runtime/src/index.ts)
- [Bootstrap, lifecycle, and application implementation](../../packages/runtime/src/bootstrap.ts)
- [Bootstrap regression tests](../../packages/runtime/src/bootstrap.test.ts), [application race and shutdown tests](../../packages/runtime/src/application.test.ts)
- [Shutdown phase completion tracking](../../packages/runtime/src/retryable-shutdown.ts), [platform lifecycle tests](../../packages/runtime/src/platform-shell.lifecycle.test.ts)
- [Startup and shutdown behavioral contract](../../docs/architecture/lifecycle-and-shutdown.md)
- [Explicit DI and module registration](../../packages/core/README.md)

The code and expected event order in this chapter are based on the current source and contracts. Running the chapter's experiment on Node24, closing real database connections, and verifying OS signals and listener drain are not validation results obtained here.
