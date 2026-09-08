# @fluojs/event-bus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

In-process event publishing and subscription for fluo. It features decorator-based handler discovery and support for external transport adapters like Redis Pub/Sub for cross-process communication.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Runtime-Specific and Integration Subpaths](#runtime-specific-and-integration-subpaths)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/event-bus

# Include the optional peer when using @fluojs/event-bus/redis
npm install @fluojs/event-bus ioredis
```

`@fluojs/event-bus` supports Node.js `>=24.0.0 <27` as its package-owned support contract.

## When to Use

- When you need to decouple components by communicating via events instead of direct service calls.
- When multiple parts of the system need to react to a single action (e.g., sending an email and updating a dashboard when a user registers).
- When you need a simple in-memory event bus with optional support for distributed systems.

## Quick Start

### 1. Define an Event and Handler

Create an event class and a public instance handler method decorated with `@OnEvent`. Private and static methods are not supported.

```typescript
import { OnEvent } from '@fluojs/event-bus';

export class UserSignedUpEvent {
  constructor(public readonly email: string) {}
}

export class NotificationService {
  @OnEvent(UserSignedUpEvent)
  async notify(event: UserSignedUpEvent) {
    console.log(`Sending welcome email to: ${event.email}`);
  }
}
```

### 2. Register and Publish

Import `EventBusModule` and inject `EventBusLifecycleService` to publish events.

Use `EventBusModule.forRoot(...)` to wire the in-process event bus. Event-bus providers are global by default (`global: true`), so `EventBusLifecycleService` and the `EVENT_BUS` compatibility token are visible to modules that import the root graph. Pass `EventBusModule.forRoot({ global: false })` when you need module-local visibility instead.

```typescript
import { Module, Inject } from '@fluojs/core';
import { EventBusModule, EventBusLifecycleService } from '@fluojs/event-bus';

@Inject(EventBusLifecycleService)
export class UserService {
  constructor(private readonly eventBus: EventBusLifecycleService) {}

  async signUp(email: string) {
    // Logic to save user...
    await this.eventBus.publish(new UserSignedUpEvent(email));
  }
}

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [NotificationService, UserService],
})
export class AppModule {}
```

`EventPublishOptions` bounds both matching local handler work and optional transport publication. `publish(event, options?)` supports `signal`, `timeoutMs`, and `waitForHandlers`. `waitForHandlers` defaults to `true`; awaited local handlers and awaited transport publishes share the same timeout and cancellation bounds. When those bounds settle the caller-facing publish promise before the underlying handler or transport work finishes, shutdown still tracks that underlying awaited work until it settles or the shutdown drain bound expires. When `waitForHandlers` is set to `false`, publishing returns immediately and skips timeout bounds, while the handler and transport work continue in the background and remain part of shutdown drain tracking. During shutdown, the event bus drains in-flight awaited and background publish work plus inbound transport handler work before closing the transport, ignores new publish calls after the lifecycle has started stopping, and ignores inbound transport callbacks that arrive after shutdown begins. The drain reaches quiescence by rechecking the live work set after each settled snapshot under one absolute deadline, so handler or transport work registered by an already-active publish cannot be skipped before transport close. Shutdown drain is bounded by `EventBusModule.forRoot({ shutdown: { drainTimeoutMs } })`, which defaults to 5000ms; if active dispatch work is still stuck after the bound, the bus records a degraded status diagnostic, logs a warning, and continues transport cleanup instead of hanging application close indefinitely.

Handler failure isolation is narrower than publish completion. Matching local listener failures are logged and isolated, while other matching listeners continue. A local listener failure alone does not reject `publish(...)`. Inbound transport listeners follow the same isolation rule, so inbound callback completion does not surface isolated listener failures. Publisher completion does not prove that every listener succeeded. Timeout, cancellation, transport publication, bootstrap, and other publisher failures are outside this listener-failure contract. Those failures retain their own separately documented behavior.

**Migration note:** applications that use `waitForHandlers: false` should now budget for `app.close()` to wait up to `shutdown.drainTimeoutMs` for background handler and transport work before transport cleanup continues. Keep that work bounded or configure a drain budget appropriate for the application.

### Publishing with Results

`publish(...)` remains the existing best-effort API: its `Promise<void>` return type, failure isolation, and existing logging with raw errors do not change. Opt into `EventBusLifecycleService.publishWithResult(event, options?)` only when caller policy needs to evaluate reaction results. This API uses the same module registration, effective singleton handler discovery, and per-recipient payload cloning, and returns `Promise<EventPublishResult>`. The `EVENT_BUS` runtime facade supports it too. Consumers injecting the facade can use the additive `EventBusWithResults` type from the root `@fluojs/event-bus` package. The legacy `EventBus` interface gains no method, so existing implementations remain valid.

The `EVENT_BUS` token carries `Token<EventBusWithResults>`, so `container.resolve(EVENT_BUS)` infers the result-aware facade. Existing consumers can still explicitly call `container.resolve<EventBus>(EVENT_BUS)`, which exposes only the legacy `publish` contract.

| Inputs and defaults | Contract |
| --- | --- |
| `event` | An instance of an event class. Payload validation and excluding sensitive information belong to the application. |
| `waitForHandlers` | Selected from the call options, then module `publish` defaults; the final default is `true`. |
| `timeoutMs` | Selected in the same order; omitted means no bound. Positive finite values are floored to integer milliseconds; non-positive or non-finite values disable the bound. Ignored with `waitForHandlers: false`. |
| `signal` | An optional per-call `AbortSignal`. An already-aborted signal skips work that has not started. |

| Result `status` | Meaning |
| --- | --- |
| `settled` | `outcomes` contains observations of the selected local handlers and outbound transport channels. It does not mean every reaction succeeded. |
| `no-recipients` | There are neither matching local handlers nor a configured transport; `outcomes` is an empty array. |
| `rejected` | The lifecycle state refusing publication is returned as `reason: 'stopping' \| 'stopped' \| 'failed'`. |
| `background` | Work was scheduled with `waitForHandlers: false`; `completion: Promise<EventPublishSettlement>` observes the actual work results. |

`EventPublishSettlement` is either `settled` or `no-recipients`. Each `EventDeliveryOutcome` contains a `target` and one of the following statuses, without payloads, handler return values, or raw errors.

| Outcome `status` | Additional fields |
| --- | --- |
| `succeeded` | None |
| `failed` | `reason: 'handler' \| 'transport' \| 'not-callable'` |
| `timed-out` | `timeoutMs` |
| `cancelled` | `started`: `false` when skipped before starting, `true` when the wait was cancelled after starting |

The result array is not in completion order. It lists matching effective local handlers in discovery order first, followed by outbound channels in channel order. A handler target has `kind: 'handler'`, a zero-based `index` scoped to this publication, `moduleName`, `targetName`, and `methodName`. That index is not a persistent ID. A transport target has `kind: 'transport'` and `channel`. Channels follow the event's concrete-to-base class lineage, then matching descriptor channels, retaining only the first occurrence of each channel. Array order does not guarantee serialized execution.

A transport `succeeded` outcome means only that the adapter successfully published to that channel. It reports neither the presence nor processing results of remote handlers or subscribers, and implies no durability. An adapter success with zero subscribers remains a transport success; it does not become `no-recipients`.

Awaited `timed-out`/`cancelled` outcomes are caller observations only. Started work can continue and remains tracked by shutdown drain. Background completion ignores timeout and post-start cancellation and waits for actual work to settle, so it can remain pending after bounded shutdown and be lost on process exit. Skipping work for a pre-start abort also applies in the background. The bus adds no persistence, retry, or remote acknowledgement.

Discovery and payload preparation errors still reject the promise. There is no separate aggregate-reject API: the caller examines `status` and every outcome to choose a reaction-failure policy. The following is a **scoped consumer function** using an injected service in an application that has already registered `EventBusModule.forRoot()` and the required handlers. It treats the publication as successful only when at least one required reaction exists and all selected attempts succeeded.

```typescript
import { EventBusLifecycleService } from '@fluojs/event-bus';

async function requireReactions(eventBus: EventBusLifecycleService, event: object): Promise<void> {
  const result = await eventBus.publishWithResult(event, { waitForHandlers: true });
  if (
    result.status !== 'settled' ||
    result.outcomes.length === 0 ||
    !result.outcomes.every(outcome => outcome.status === 'succeeded')
  ) {
    throw new Error('Required event reactions did not succeed.');
  }
}
```

Even this policy cannot prove that a missing required handler was configured. Verify required local handler registration in application tests, and design a separate acknowledgement contract if remote processing completion is required. The [two consumer examples in the messaging guide](../../apps/docs/content/docs/guides/messaging-workflows.mdx) contrast legacy best-effort `publish` for last-used bookkeeping after successful authentication, carrying only a token record ID, with explicit checks for result-required reactions.

Handler/transport failure logs reported by `publishWithResult` retain the existing safe target/status messages but do not pass the raw handler/transport error argument to the logger. This matches the result contract that excludes raw errors and handler return values. Logs written directly by application handlers or adapters remain the application's responsibility; this is not a global sanitization policy for legacy `publish` or inbound delivery logs.

## Common Patterns

### Distributed Fan-out (Redis)

Extend the event bus to other processes by plugging in a transport adapter. The Redis subpath uses the optional `ioredis` peer, so install it in the application that creates the transport.

```typescript
import { EventBusModule } from '@fluojs/event-bus';
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';
import Redis from 'ioredis';

const redisOptions = { host: 'localhost', port: 6379 };
const publishClient = new Redis(redisOptions);
const subscribeClient = new Redis(redisOptions);

EventBusModule.forRoot({
  transport: new RedisEventBusTransport({
    publishClient,
    subscribeClient,
  }),
});
```

Create dedicated, separate `publishClient` and `subscribeClient` instances for the transport. Redis puts a subscribed connection into Pub/Sub mode, so the subscriber must not also publish or run ordinary commands. Both clients remain caller-owned: `RedisEventBusTransport.close()` removes the transport subscriptions and listener but does not disconnect either client. Close them from their lifecycle owner after the event bus has finished teardown.

Redis Pub/Sub is a fan-out transport, not a durable work queue. When multiple application instances subscribe to the same event channel, each instance can see the same published fact. Handlers that mutate state, send notifications, or call external systems should therefore be idempotent: carry a stable event identifier or business key in the payload, record which reactions have already been applied, and make repeat deliveries converge to the same result instead of performing the side effect twice.

Keep `@OnEvent(...)` handlers small and bounded. They are a good fit for fast local projections, cache invalidation, lightweight notifications, and other reactions that can finish within the publish timeout and shutdown drain window. If a reaction is slow, failure-prone, retryable, or needs operator-visible dead-letter handling, hand off a durable job to `@fluojs/queue` from the event handler instead of doing the work inline. Use an application-owned unique claim for the handoff, then mark the handoff as enqueued only after `queue.enqueue(...)` succeeds; if enqueue fails, release the pending claim so a later duplicate event can retry safely.

The `this.reactions` helper in the example below represents an application-owned claim store, not an API from `@fluojs/event-bus` or `@fluojs/queue`. Back it with storage that can atomically claim a business key and recover stale pending claims according to your application's retry policy.

```typescript
import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { QueueLifecycleService } from '@fluojs/queue';

export class GenerateInvoiceJob {
  constructor(public readonly orderId: string) {}
}

@Inject(QueueLifecycleService)
export class BillingEventsHandler {
  constructor(private readonly queue: QueueLifecycleService) {}

  @OnEvent(OrderPlacedEvent)
  async enqueueInvoice(event: OrderPlacedEvent) {
    const handoffKey = `${event.orderId}:invoice`;

    if (!(await this.reactions.claimPending(handoffKey))) {
      return;
    }

    try {
      await this.queue.enqueue(new GenerateInvoiceJob(event.orderId));
      await this.reactions.markEnqueued(handoffKey);
    } catch (error) {
      await this.reactions.releasePending(handoffKey);
      throw error;
    }
  }
}
```

Use the event bus to state that a business fact happened. Use Queue when the reaction needs retry, backoff, workload isolation, or dead-letter inspection. If the process can crash while a claim is pending, make the application-owned claim store recover stale pending records according to your application's retry policy.

### Versioned Event Keys

Use static `eventKey` to ensure stable channel names regardless of class minification or renames.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';
}
```

Handlers are discovered from normalized effective singleton provider registrations and controllers across imported modules. When duplicate provider tokens are registered, only the DI winner is discovered; factory-provider scope follows the same canonical normalization as container resolution. Event-bus bootstrap resolves every discovered handler target before reporting ready, and a real handler target resolution failure fails bootstrap instead of silently reporting ready with skipped handlers. Discovery inspects singleton `useValue` instances that already carry handler metadata and singleton `useFactory` providers only when their provider token is the handler class with `@OnEvent(...)` metadata, so unrelated factory providers are not invoked during event-bus bootstrap. Each handler receives an isolated cloned payload, and class inheritance is supported through `instanceof` matching. With an external transport configured, publishing a subclass event fans out to the subclass channel and every inherited event channel in its prototype chain, even when the publisher process has no matching local handlers for those types. A subclass uses its own `static eventKey` only when it declares one directly; otherwise its class name remains the subclass channel while base classes keep their own stable keys. `publish()` records and logs handler and transport failures but resolves after attempts settle; with `waitForHandlers: false`, it resolves after scheduling shutdown-tracked background work.

## Public API Overview

### Core
- `EventBusModule.forRoot({ global?, publish?, shutdown?, transport? })`: Main entry point for event bus registration. `global` defaults to `true`; set `global: false` to keep event-bus providers visible only through the module that imports the event-bus module.
- `EventBusLifecycleService`: Primary service for legacy `publish(event, options?)`, opt-in `publishWithResult(event, options?)`, and platform status snapshots.
- `@OnEvent(EventClass)`: Decorator to mark a public instance method as an event handler.
- `EVENT_BUS`: Compatibility injection token for the publish facade.
- `createEventBusPlatformStatusSnapshot(...)`: Status snapshot helper used by diagnostics and health surfaces.

### Interfaces
- `EventBusTransport`: Contract for implementing external transport adapters.
- `EventBus`, `EventPublishOptions`, `EventBusModuleOptions`, `EventType`: Type-only contracts for publishing, defaults, transports, and stable event keys.
- `EventBusWithResults`: Result-aware facade contract extending the legacy `EventBus`. `EventDeliveryTarget`, `EventDeliveryStatus`, `EventDeliveryOutcome`, `EventPublishSettlement`, and `EventPublishResult` are also type-only root exports.
- `EventBusLifecycleState`, `EventBusStatusAdapterInput`, `EventBusPlatformStatusSnapshot`: Status snapshot contracts.

Transport bootstrap subscribes once per unique event channel. `eventKey` controls the transport channel name when present. If a later transport subscription fails during bootstrap, the event bus closes the transport to roll back any channels that were already opened before rethrowing the subscription error. Inbound transport messages that arrive after shutdown starts are ignored before local handler dispatch.

## Runtime-Specific and Integration Subpaths

| Concern | Subpath | Exports |
| --- | --- | --- |
| Redis Pub/Sub transport | `@fluojs/event-bus/redis` | `RedisEventBusTransport`, `RedisEventBusTransportOptions` |

`RedisEventBusTransport` stays on the explicit `@fluojs/event-bus/redis` subpath so the root `@fluojs/event-bus` entrypoint remains focused on module registration, local publishing, decorators, and type-only contracts. Applications using this subpath must install the optional `ioredis` peer and supply dedicated, separate `publishClient` and `subscribeClient` instances. This Redis adapter JSON-decodes inbound Redis messages and drops malformed JSON before handler dispatch; that parsing rule does not apply to arbitrary `EventBusTransport` implementations. During shutdown, the adapter unsubscribes the channels it registered and detaches its message listener, but `close()` does not disconnect the caller-owned clients. If unsubscribe fails, `close()` still detaches the listener while retaining the registered channels so a later `close()` retries the same cleanup. The application or client-owning module must close those clients separately after event-bus teardown.

## Related Packages

- `@fluojs/cqrs`: Built on top of the event bus for more formal architectural patterns.
- `@fluojs/redis`: Provides the clients required for `RedisEventBusTransport`.

## Example Sources

- [Executable result-aware publication example](./examples/publish-results.ts): Comparing best-effort consumers with consumers that check results.
- [Results and sanitized failure observation tests](./src/publish-result.test.ts), [timeout/cancellation tests](./src/publish-result-bounds.test.ts), [lifecycle/background completion tests](./src/publish-result-lifecycle.test.ts).
- [Public result types](./src/publish-result.ts), [publication implementation](./src/service.ts), [facade wiring](./src/module.ts).
- `packages/event-bus/src/module.test.ts`: Handler discovery and publish/subscribe tests.
- `packages/event-bus/src/public-surface.test.ts`: Public API contract verification.
- `packages/event-bus/src/status.test.ts`: Status snapshot semantics.
- `packages/event-bus/src/shutdown-late-work.test.ts`: Late handler and transport registration shutdown races.
- `packages/event-bus/src/transports/redis-transport.test.ts`: Redis transport behavior.

Run the owner verification commands for this source evidence from the repository root. These examples target the workspace checkout, not verification of the latest registry release.

```bash
pnpm --dir packages/event-bus test
pnpm --filter '@fluojs/event-bus...' build
```

After building, transform the example with the repository's Babel decorator configuration and run it on a supported Node.js version. Writing inside the Git-ignored `dist/` also allows self-package imports to resolve. The example starts neither an HTTP server nor Redis and prints `authenticated: true`, `projectionReady: false`, succeeded/failed outcomes, and background completion.

```bash
pnpm exec babel packages/event-bus/examples/publish-results.ts --out-file packages/event-bus/dist/publish-results.example.mjs --config-file ./tooling/babel/babel.config.cjs
node packages/event-bus/dist/publish-results.example.mjs
```
