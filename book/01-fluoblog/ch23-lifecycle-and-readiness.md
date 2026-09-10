# Designing Startup and Shutdown

<!-- book:volume=01-fluoblog;chapter=23 -->

[Previous: Explaining Slow Requests and Failures](./ch22-observability.md) - [Volume 1 Contents](./toc.md) - [Next: The First Release and Operational Retrospective](./ch24-first-release.md)

For a few seconds immediately after deploying a new version, saving posts failed. The process was running and the port was open. A short while later, everything returned to normal. The next deployment brought the opposite incident: an instance that had received a shutdown signal was still processing requests when database connection disposal began. Unit tests of steady-state behavior alone cannot easily explain either incident.

FluoBlog's lifetime is more than a single state called "server running." It builds a module graph, prepares connections, begins accepting traffic, blocks new work, drains admitted work, and closes resources. Unless each phase has a defined promise, operators will send traffic to an unready instance simply because its process is alive.

This chapter targets a Node.js 24 process in which Fastify owns the listener. Scheduled publication and database transactions remain in the same application as in the previous chapters. We do not split them into a new operations-only service. Without actually changing an external deployment system, we implement the readiness and shutdown boundaries the application needs to provide.

## Liveness, Diagnostics, and Readiness Ask Different Questions

The ability to run an event loop does not mean a process can safely save posts. It can produce HTTP responses even when the database is disconnected or the required schema does not match the code. Conversely, it may still serve already published posts while a subscription email provider is temporarily slow. Decide feature by feature whether a failure in one dependency should stop all traffic.

In `@fluojs/terminus`, `/health` aggregates diagnostics. When an indicator or platform diagnostic is unhealthy, it returns 503 and a report that includes the cause. `/ready` answers whether to accept traffic. When the deployment layer is configured to probe this endpoint, 200 admits traffic and 503 removes the instance from rotation. Terminus does not control the load balancer directly. The response body's `status` is one of `ready`, `starting`, or `unavailable`, but the deployment layer's admission decision is binary. This is not a separate severity response that says, "partly ready, so send a little traffic."

When the runtime marker is starting, `/ready` returns 503 with `{ status: 'starting' }`. Even with a ready marker, an additional condition returning `false`, a failing readiness-participating indicator, or failing platform readiness produces 503 with `{ status: 'unavailable' }`. Only when all pass does it return 200 with `{ status: 'ready' }`. A custom readiness callback that throws or rejects propagates through HTTP error handling rather than becoming this boolean rejection, so return `false` for an expected inability to accept traffic. The code below uses `path: '/internal'`, making the actual request paths `/internal/health` and `/internal/ready`.

Terminus does not create a `/live` endpoint that checks only process liveness by default. Using a database-inclusive `/health` response directly as the condition for process restarts can create a cycle of restarting every app during a shared database outage. Deployment environments that need a narrow liveness check must define a separate application or host boundary. Do not mistake the two endpoints created in this chapter for three kinds of probes.

By default, an indicator participates in both health and readiness. `readiness: false` retains its diagnostics but prevents that indicator alone from blocking traffic. This may be appropriate, for example, if the application can fall back to a basic post list without a separate external search service. But if the cache and subscription queue share Redis and actual requests depend on successful queue writes, do not exclude Redis merely because "the cache is optional." Classify a dependency as optional only when behavior during its failure has been implemented.

This opt-out excludes only that indicator's probe from readiness. If the same dependency is registered as a separate platform component and lowers readiness, admission is still blocked. HTTP readiness requires platform status to be exactly `ready`, so even `degraded` with `critical: false` does not pass. Application `readinessChecks` also add conditions rather than replacing the indicator and platform checks.

## Where You Import a Module Changes Readiness

Even a correct SQL probe cannot run if Terminus cannot find the database connection. Ordinary non-global sibling modules cannot see one another's providers, so dependencies must be explicit in Terminus's `imports`. This book's Chapter 10 registration, however, is intentionally global. The root imports `BlogDatabaseModule` from `src/database/blog-database.module.ts` once, and its `PrismaModule.forRootAsync` owns a client per container using `global: true` and `inject: [AppSettings]`. Terminus also receives this global `PrismaService` through injection.

Chapter 1's generated basic registration is the runtime's `HealthModule.forRoot()`, not Terminus. To extend the same default health/readiness paths with Terminus, replace that basic registration and transfer relevant `path` and `endpointMiddleware` settings. Terminus supplies a health module internally, so do not register both at the same paths. If Terminus is already present, extend the existing registration. Preserve config, greeting, lifecycle scripts, and application settings. The code below configures operations at separate `/internal` paths; it is not presented as code that moves the starter's default paths.

The following is the **complete `src/operations/operations.module.ts`**. `serviceToken: PrismaService` resolves only the existing lifecycle-aware service. Do not create a new database module or module-scope `client`. Because `TrafficModule` is not global, list it in Terminus's imports as well. Chapter 22's `operationsConfig` is the validated snapshot of operational tokens.

```typescript
import { Module } from '@fluojs/core';
import {
  ForbiddenException, type MiddlewareContext, type Next,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import {
  createPrismaHealthIndicatorProvider,
  TerminusModule,
} from '@fluojs/terminus';
import { operationsConfig } from '../config/operations-config.js';
import { TrafficModule, TrafficIndicator } from './traffic.js';

export function createOperationsModule(healthToken: string | false) {
  if (healthToken !== false && healthToken.trim().length === 0) {
    throw new Error('A non-empty health token is required.');
  }
  class OperationsAccessMiddleware {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      if (context.request.headers['x-health-token'] !== healthToken) {
        throw new ForbiddenException('Operations access denied.');
      }
      await next();
    }
  }

  @Module({
    imports: [
      TrafficModule,
      TerminusModule.forRoot({
        path: '/internal',
        imports: [TrafficModule],
        endpointMiddleware: healthToken === false ? [] : [OperationsAccessMiddleware],
        indicatorProviders: [
          createPrismaHealthIndicatorProvider({
            key: 'posts-database',
            serviceToken: PrismaService,
          }),
          TrafficIndicator,
        ],
        execution: { indicatorTimeoutMs: 1_500 },
      }),
    ],
  })
  class OperationsRegistration {}

  return OperationsRegistration;
}

export const OperationsModule = createOperationsModule(
  operationsConfig.HEALTH_TOKEN ?? false,
);
```

We implement this example's `TrafficIndicator` below. The existing `src/app.ts` keeps AccountsModule and PostsModule and imports OperationsModule. The root app also imports TrafficModule directly so startup code can resolve TrafficGate. This reuses the same module class; it does not create two separate gates.

The `PrismaService`-based indicator checks the connection's lifecycle state before running the actual probe and uses the active client through `current()`. It does not report ready during shutdown merely because the raw client can still accept SQL. A token absent from the entire graph, reported as down after boot, is also different from a token that exists in another module but lacks visibility and causes `MODULE_VISIBILITY_ERROR` at bootstrap. The latter is a composition error, not a database outage, and must be fixed before deployment.

Verify these paths first on a local loopback listener. Without `HEALTH_TOKEN`, both endpoints are open without a token, so external deployments need an internal network policy. If a token is configured, class-based `endpointMiddleware` applies to both health and readiness, and requests require `x-health-token`. This is separate from `METRICS_TOKEN` and does not reuse Chapter 17's user login cookie. Nor should you assume that attaching a regular controller's `@UseGuards` protects a runtime-owned route.

## The Order of Startup Hooks and Listener Opening

After building the module graph and DI container, the runtime resolves the instances that participate in the lifecycle. It then executes their `onModuleInit()` hooks, followed by `onApplicationBootstrap()`. The readiness marker changes to ready only after platform startup succeeds. The HTTP dispatcher and listener are boundaries distinct from this preparation process.

`FluoFactory.create()` owns initialization and common middleware; `app.listen()` awaits listening and the selected signal callback. Below, `createNodeShutdownSignalRegistration(false)` disables default signals so this entrypoint owns shutdown. Factory handles startup-failure cleanup without choosing admitted-request drain or host signal policy.

The public `app.state` values `bootstrapped`, `ready`, and `closed` form a different model from the three HTTP body states. `app.ready()` checks critical platform readiness without opening a listener or changing state to `ready`. After that check, `app.listen()` awaits adapter activation and changes state to `ready` only if shutdown has not started. This startup check does not run Terminus indicators or custom HTTP readiness callbacks, so it is not evidence that `/ready` returns 200. In host-owned request paths such as Workers and Next.js, adapter activation may connect a dispatcher rather than bind a new socket.

A failed startup may still have partially succeeded. A database connection might open before later initialization fails. In that case the runtime invokes disposal hooks with the signal value `bootstrap-failed` and attempts container disposal. Application disposal code must release only resources it actually acquired, without assuming it is called only after startup completes successfully. Catching an initialization failure and opening the service with an empty repository is a change to the data contract, not recovery.

Factory creation failure attempts cleanup of acquired resources, including the supplied HTTP adapter with `bootstrap-failed`, while preserving the initiating error. Failure during readiness, listen, startup logging, or explicit host registration also attempts `app.close('bootstrap-failed')`. This guarantees cleanup attempts, not successful disposal by every resource; HTTP startup failure is terminal and requires a fresh application.

Also avoid large data migrations in startup hooks. Two instances starting together can race on the same change, and work that takes minutes can dominate listener readiness time. Own schema changes and data transformations as separate deployment steps, limiting application startup to checking whether required dependencies are usable. Catch up on overdue scheduled publications through normal small batches rather than processing the entire backlog indefinitely in a startup hook.

## Lowering Readiness Does Not Finish In-Flight Requests

A readiness change to 503 does not make the load balancer stop every request immediately. Connected clients and requests already in transit remain. More importantly, Fluo's shutdown hooks run before adapter close. Treating `onModuleDestroy` as "the place called after all HTTP connections are closed" produces the wrong order.

As soon as the runtime's `Application.close()` begins, it closes admission for operations such as new `Application.dispatch()`, provider resolution, and listen. After pending listen and connected microservice shutdown, parent teardown resets the readiness marker to starting, then proceeds through runtime cleanup, reverse destroy hooks, reverse application shutdown hooks, adapter close, and container disposal. The admission gate does not cancel dispatch already admitted. Nor is every direct adapter or public dispatcher path guaranteed to pass through this wrapper. Do not expand this into a guarantee that every listener request automatically drains to the desired unit of business work. This chapter uses a small application-owned traffic gate to wait for ordinary HTTP requests before calling `app.close()`.

While teardown is pending or after it fails, public `app.state` retains its previous value; only success changes it to `closed`. Runtime admission does not reopen even if state still appears `ready`. An explicit close retry skips completed runtime phases and follows each stage's retry contract: it is cleanup, not a restart. A starting response may be observable while an HTTP probe can still reach a connected adapter, but a closed listener is not guaranteed to send a 503 response.

`src/operations/traffic.ts` is a **complete file**. The gate owns neither the database nor external connections. It tracks whether to accept new requests and how many are executing within the middleware boundary. Internal diagnostic requests are excluded from draining so the reason for shutdown remains queryable while waiting.

```typescript
import { Inject, Module } from '@fluojs/core';
import {
  HttpException,
  type MiddlewareContext,
  type Next,
} from '@fluojs/http';
import type { HealthIndicator, HealthIndicatorResult } from '@fluojs/terminus';

export class TrafficGate {
  private accepting = true;
  private active = 0;
  private idle = Promise.withResolvers<void>();

  constructor() {
    this.idle.resolve();
  }

  isAccepting(): boolean {
    return this.accepting;
  }

  enter(): boolean {
    if (!this.accepting) return false;
    if (this.active === 0) this.idle = Promise.withResolvers<void>();
    this.active += 1;
    return true;
  }

  leave(): void {
    this.active -= 1;
    if (this.active === 0) this.idle.resolve();
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  waitForIdle(): Promise<void> {
    return this.idle.promise;
  }
}

@Inject(TrafficGate)
export class TrafficMiddleware {
  constructor(private readonly gate: TrafficGate) {}

  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    const path = context.request.path;
    if (
      path === '/internal/health'
      || path === '/internal/ready'
      || path === '/internal/metrics'
    ) {
      await next();
      return;
    }
    if (!this.gate.enter()) {
      throw new HttpException(503, 'The instance is draining.', {
        code: 'SERVICE_UNAVAILABLE',
      });
    }
    try {
      await next();
    } finally {
      this.gate.leave();
    }
  }
}

@Inject(TrafficGate)
export class TrafficIndicator implements HealthIndicator {
  readonly key = 'traffic-admission';

  constructor(private readonly gate: TrafficGate) {}

  async check(key: string): Promise<HealthIndicatorResult> {
    return {
      [key]: {
        status: this.gate.isAccepting() ? 'up' : 'down',
      },
    };
  }
}

@Module({
  providers: [TrafficGate, TrafficMiddleware],
  exports: [TrafficGate, TrafficMiddleware],
})
export class TrafficModule {}
```

Do not duplicate `TrafficIndicator` in TrafficModule's ordinary provider list. Terminus's `indicatorProviders` owns it, importing only the gate it needs from TrafficModule's exports. Injection is not based on the interface name alone: `@Inject(TrafficGate)` specifies the actual class token.

The gate's shutdown decision is irreversible. Switching back to accepting because one request fails during draining can make new work collide with resource disposal already underway. Call `leave` in the middleware's `finally` exactly once for each successful admission. Do not treat it as a public counter that application code can invoke arbitrarily many times. A Promise signals the event of the request count reaching zero, eliminating the need to poll the number at intervals.

This gate waits for `next()` to complete. It does not wait for every response byte to reach the reader, nor does it include work the handler has detached. The lifetimes of queues, Cron, and streaming sessions must be handled under their owning modules' contracts. Responding before a post save finishes and detaching the database work does not become safe just because this gate exists. Keep the earlier principle: finish essential changes before responding, and hand long-running work to a job boundary with persistent input.

## The Entry Point That Owns Shutdown

First apply the **addition fragment for `src/app.ts`**. Keep the existing imports and OpenAPI sources, adding only the following two entries. The root's BlogDatabaseModule remains registered once, and Chapter 22's ObservabilityModule and SubscriptionsModule reuse the same identities.

```diff
+import { OperationsModule } from './operations/operations.module.js';
+import { TrafficModule } from './operations/traffic.js';
@@ imports
+    OperationsModule, TrafficModule,
```

The following is a **replacement for `src/main.ts`** using the existing `src/app.ts`, Chapter 22's `blogAccessObserver`, and TrafficModule above. Apply the composition changes below to AppModule while keeping all accounts, authentication, native forms, uploads, subscriptions, cache, and scheduling modules. Use `blogConfig.PORT`, the same value as Chapter 9's `AppSettings.port`, and retain the loopback host. `PUBLIC_ORIGIN`, database configuration, and authentication settings also remain under the existing AppSettingsModule validation path. Explicitly preserve Chapter 18's 6 MiB body and total multipart limits, 5 MiB file limit, and one-file limit.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { ensureMetadataSymbol } from '@fluojs/core';
import { createCorrelationMiddleware } from '@fluojs/http';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { blogConfig } = await import('./config/app-settings.module.js');
const { blogAccessObserver } = await import('./observability/access-log.js');
const { TrafficGate, TrafficMiddleware } = await import('./operations/traffic.js');

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({
    host: '127.0.0.1',
    port: blogConfig.PORT,
    maxBodySize: 6 * 1024 * 1024,
    multipart: {
      maxFileSize: 5 * 1024 * 1024,
      maxFiles: 1,
      maxTotalSize: 6 * 1024 * 1024,
    },
    shutdownTimeoutMs: 5_000,
  }),
  middleware: [createCorrelationMiddleware(), TrafficMiddleware],
  observers: [blogAccessObserver],
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(false),
});
await app.listen();
const gate = await app.get(TrafficGate);
let closing: Promise<void> | undefined;

function close(signal: string): Promise<void> {
  if (closing) return closing;
  gate.stopAccepting();
  closing = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        gate.waitForIdle(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('HTTP work drain exceeded 10000ms.')),
            10_000,
          );
        }),
      ]);
    } catch (error: unknown) {
      process.exitCode = 1;
      console.error('HTTP drain failed.', error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    await app.close(signal);
  })();
  return closing;
}

function onSignal(signal: string): void {
  void close(signal).catch((error: unknown) => {
    process.exitCode = 1;
    console.error('Application shutdown failed.', error);
  });
}

process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));
```

Without `shutdownSignals: false`, the helper's default shutdown path and this file's preliminary drain path could both run. Disable default signal registration so shutdown has one owner. Because this example registers signal handlers after readiness, it is not a complete deployment supervisor that also manages process termination during startup. Runtime cleanup owns startup failure, while the deployment host owns the deadline for forcibly terminating the entire process.

`closing` lets two consecutive signals observe the same operation. The gate closes before the first await, so the next request cannot increase the work count. After 10 seconds, the code records failure and proceeds to resource disposal. There is no guarantee that in-progress SQL, uploads, or mail operations have been canceled or rolled back. A change may already have committed while its response was lost, and remaining work may fail as disposal overlaps with it. The exit code also records failure so a shutdown that exceeded its budget is not reported as normal draining or safe forced disposal.

Fastify's `shutdownTimeoutMs` bounds the wait for adapter close. Setting it to 0 starts close immediately, but does not cancel underlying cleanup or instantly kill the process. Likewise, do not infer from the default Node signal helper's name `forceExitTimeoutMs` that it forcibly invokes `process.exit()`. On timeout, that boundary records failure and sets the exit code. The code above uses a custom signal path, so it does not rely on that helper timeout.

The total shutdown budget is not simply the largest timeout. In this example, waiting for HTTP work, draining Cron, Queue, and Email, database and other hooks, and Fastify close consume time according to their order and partial overlap. Set the deployment host's grace period with headroom based on the observed total duration. In particular, application-level code alone does not guarantee forced termination when a custom hook stalls. Scheduled data and transactions must still support recovery after external forced termination.

## Experimenting with Lifecycle Order at the Source Boundary

Instead of memorizing shutdown-hook names, inspect their invocation order directly. The following `src/operations/lifecycle-order.spec.ts` is a **standalone experiment file**. It uses the actual `FluoFactory.create`, replacing only the adapter with an event-recording test double. This tests the contract that the runtime executes hooks before adapter close, not HTTP transport conformance.

```typescript
import { Module } from '@fluojs/core';
import type { HttpApplicationAdapter } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';

it('runs resource hooks before adapter close', async () => {
  const events: string[] = [];

  class ResourceProbe {
    onModuleInit(): void {
      events.push('init');
    }
    onApplicationBootstrap(): void {
      events.push('bootstrap');
    }
    onModuleDestroy(): void {
      events.push('destroy');
    }
    onApplicationShutdown(signal?: string): void {
      events.push(`shutdown:${signal}`);
    }
  }

  @Module({ providers: [ResourceProbe] })
  class ProbeModule { }

  const adapter: HttpApplicationAdapter = {
    async listen() {
      events.push('listen');
    },
    async close() {
      events.push('adapter-close');
    },
  };
  const app = await FluoFactory.create(ProbeModule, { adapter });
  try {
    expect(events).toEqual(['init', 'bootstrap']);
    await app.listen();
    await app.close('SIGTERM');
    expect(events).toEqual([
      'init',
      'bootstrap',
      'listen',
      'destroy',
      'shutdown:SIGTERM',
      'adapter-close',
    ]);
  } finally {
    await app.close();
  }
});
```

When multiple lifecycle instances exist, each startup phase runs in registration order and each shutdown phase in reverse instance order. All `onModuleDestroy` calls precede all `onApplicationShutdown` calls. These two and the two startup hooks are the supported public hooks; adding `beforeApplicationShutdown` does not make Fluo call it. The underlying PlatformShell rejects overlapping `start` or `stop` calls as conflicts, whereas concurrent Application `close` calls share the in-progress Promise. Do not conflate the behavior of layers with similar names.

Begin the TrafficGate experiment by creating a Promise signal that an in-flight request has reached its handler. After receiving that signal, call `stopAccepting` and check that a second `/posts` request returns 503. The idle signal must not complete before the Promise holding the first request is released. Once released, the first request should complete normally and `waitForIdle()` should finish. Meanwhile, readiness requests must pass through the gate to Terminus and return 503. The next chapter's request test captures this scenario in actual code.

Distinguish stalled probes as another failure case. Terminus's `indicatorTimeoutMs` limits waiting and reports the indicator as down. If a previous probe is still running in the same container, it does not overlap a new probe for that indicator. A timeout does not, however, mean that in-progress SQL in an arbitrary database driver is canceled. Use probe-start and release signals to test latency, and controlled fake timers only when timeout behavior itself is under test.

During the manuscript's integration review, the lifecycle-order test was transformed in memory and run against the actual runtime with an adapter test double. A separate DI experiment using Chapter 9's AppSettings and Chapter 10's global async BlogDatabaseModule registration also confirmed tokenless 403 and authenticated 200 responses for health and ready, plus exactly one connection and one disconnection, with only the Prisma driver replaced. This did not test an actual PostgreSQL connection or a separate Fastify process receiving signals. In the reader application, run `pnpm exec vitest run src/operations/lifecycle-order.spec.ts`, then send short requests and controlled in-flight requests to a local listener and record the sequence from the first SIGTERM through readiness changes, request completion, and process exit. A small adapter-double experiment cannot prove the total shutdown time that includes the database, Cron, Queue, and Email.

## Boundaries to Keep for the First Release

If normal traffic is infrequent and a single instance is operated manually, using the default helper's signal handling without a preliminary drain gate is also an option. In that case, the product and tests must accept that some in-flight requests may fail during deployment. Conversely, copying this chapter's gate does not make long-lived streams or external work interruption-free. Understanding the unit of work to await and the data boundaries that support retries comes before implementation.

FluoBlog now distinguishes successful startup from listener opening, reflects both database state and application admission state in readiness, and waits a bounded time for ordinary HTTP work before shutdown. Published content remains immutable, and scheduled drafts recover from persistent times. Operational handling does not become an exception that relaxes domain rules.

The next chapter combines these features into evidence for the first release. We need a stronger criterion than "the server started," but we do not need to implement every possible future feature. We check whether readers can read posts, authors can safely publish drafts, and failures can be explained and recovered from through a bounded procedure.

## Canonical Docs

This chapter's startup, readiness, and shutdown explanations follow these Docs. TrafficGate, the preliminary drain budget, and operational tokens are application policies applied to the same FluoBlog, not automatic framework guarantees of uninterrupted service.

- [Documentation authority and the Book's role](../../docs/contracts/documentation-authority.md)
- [Default helpers, explicit composition, and host-owned paths](../../docs/getting-started/bootstrap-paths.md)
- [Lifecycle, terminal admission, and shutdown order](../../docs/architecture/lifecycle-and-shutdown.md)
- [Health registration, HTTP readiness bodies, and binary admission](../../docs/contracts/health-and-readiness.md)

## Implementation References

- [Terminus readiness, DI composition, and probe timeout contracts](../../packages/terminus/README.md)
- [Terminus module composition and readiness registration](../../packages/terminus/src/module.ts)
- [The indicator that uses a Prisma service token](../../packages/terminus/src/indicators/prisma.ts)
- [Sibling-module visibility success and failure tests](../../packages/terminus/src/module-sibling-composition.test.ts)
- [Runtime lifecycle and signal ownership](../../packages/runtime/README.md)
- [The architectural contract for startup and shutdown order](../../docs/architecture/lifecycle-and-shutdown.md)
- [Runtime bootstrap and shutdown phase implementation](../../packages/runtime/src/bootstrap.ts)
- [The Fastify adapter and bounded close contract](../../packages/platform-fastify/README.md)
- [Fastify run options and adapter close implementation](../../packages/platform-fastify/src/adapter.ts)
