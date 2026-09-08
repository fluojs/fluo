# When the Connection Closes Before the Request Ends

<!-- book:volume=03-internals;chapter=12 -->

[Previous: How DTOs and Responses Are Transformed](./ch11-dto-and-errors.md) - [Volume 3 Contents](./toc.md) - [Next: Comparing Node.js Adapters](./ch13-node-adapters.md)

## The Customer Has Left, but the Server Keeps Waiting

A FluoShop customer opens the order status page and then enters a subway tunnel. The browser connection drops, but the server is still waiting for the next shipping status. For a simple query, discarding one calculation result might be enough. But if an SSE connection holds request-scoped resources, event subscriptions, or a database cursor, leftover resources accumulate with each connection. A small response body does not mean a small resource cost when its lifetime is long.

This chapter covers long-running requests used by the operations dashboard and order details in the same blog and shop. A browser disconnection is not a business command to cancel an order. Persisted orders, stock reservations, and payment states remain governed by the rules from Volume 2. Connection cancellation is a signal to dispose of the response that can no longer be used and the work owned by that request.

After establishing the shape of response values in the previous chapter, we now ask how long to keep producing them and how far to send them. In particular, stopping a wait on a promise, stopping the actual operation, closing a stream, and releasing request scope are separate events. They do not mean the same thing merely because they happen close together in time.

## Request Cancellation Starts with a Signal and a Probe

Where possible, the adapter supplies an `AbortSignal` through `FrameworkRequest.signal`. On paths where assigning a signal is not appropriate, it can instead supply an `isAborted()` probe. The dispatcher preserves these surfaces when creating a per-request clone and considers the request cancelled if either reports cancellation. An `isAborted()` result of false does not invalidate a signal that has already aborted.

The ordinary handler path checks cancellation before and after work. Even if the handler returns an object after the connection drops during execution, a success response that has not yet committed is not written. This property does not mean the controller never ran. If the controller has already committed to the database, not writing the HTTP response does not undo that commit.

A probe reads the current state; it is not an event that wakes an arbitrary pending promise. A signal, by contrast, supports subscriptions, allowing file reads, remote requests, and application waiting queues to stop cooperatively. Pass the signal to cancellable APIs, and when building an asynchronous source yourself, implement how pending reads settle on abort.

The portable runtime's `createRequestAbortContext()` is an integration helper that forwards an external signal to an internal controller and removes listeners during cleanup. `trackActiveRequestTransaction()` records active requests and their settlement promises in a set; `untrackActiveRequestTransaction()` removes them and signals settlement. Despite the word transaction in these names, they are not database transactions. They form a runtime boundary through which adapters track the completion of in-progress requests.

## Winning the Race May Leave the Original Operation Running

`raceWithAbort(fn, signal)` from `@fluojs/runtime` ends the caller's wait with whichever is observed first: the operation's result or abort. With an already cancelled signal, it does not start `fn`; with cancellation during execution, it rejects with `AbortError`. It does not, however, inject cancellation functionality into the supplied `fn`. If `fn` has initiated an external payment, abort winning the race does not cancel that payment.

The following is a **complete test file** for `src/orders/abort-lab.test.ts`. Instead of an external call, it uses a promise released explicitly to observe that the original operation can finish after the caller has already left. The test timeout is an upper bound for terminating a stuck test on failure, not a duration to wait before guessing that it succeeded.

```ts
import { expect, it } from 'vitest';
import { raceWithAbort } from '@fluojs/runtime';

it('stops waiting without undoing the underlying operation', async () => {
  const gate = Promise.withResolvers<void>();
  const controller = new AbortController();
  let completed = false;
  const operation = gate.promise.then(() => {
    completed = true;
    return 'stored';
  });

  const waiting = raceWithAbort(() => operation, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(new Error('Client disconnected.'));
  await rejected;
  expect(completed).toBe(false);

  gate.resolve();
  expect(await operation).toBe('stored');
  expect(completed).toBe(true);
}, 1_000);
```

```bash
pnpm exec vitest run src/orders/abort-lab.test.ts
```

The expected result is that `completed` is false immediately after abort and true after the gate is released. An idempotency store outside this race must prevent duplicate orders. A customer retrying after failing to receive a response must be able to find the same order. Do not create a new order on the assumption that "the connection dropped, so the first attempt failed."

Read the source's listener disposal precisely as well. When `fn` settles, the abort listener is removed; a synchronous throw before a promise is returned is also converted to a settled rejection that passes through cleanup. Do not extend this into a guarantee of resource disposal when the original `fn` remains pending forever. The stoppable underlying operation, its finally, and the caller's interrupted wait must be designed together.

## With SSE, Returning Does Not Mean Finishing

`@Sse('/events')` declares a GET route and `text/event-stream` representation metadata. Its handler can return a manual `SseResponse` or a managed `AsyncIterable`. You cannot return an object once and dispose of the request as with a normal JSON handler, because the returned value is a source that will continue producing values.

On the managed path, the dispatcher obtains the iterator, calls `next()`, and writes an SSE frame for each value. A `{ data, event, id, retry }` shape is interpreted as `SseMessage`; ordinary values become data frames. An adapter without response stream capability fails through the standard error path instead of pretending to succeed. Assuming SSE works on every host requires actual adapter capabilities and verification evidence, not just types.

A manual `SseResponse` sets SSE headers and commits the response when constructed. It subscribes to request abort and raw stream close, and its close operation is idempotent. Even after the handler returns a manual response, the dispatcher maintains its lifetime until explicit close, abort, or raw stream close. Observers and request scope do not disappear merely because the handler function returned.

An SSE event id is neither a persistence guarantee nor a replay store. A browser can send `Last-Event-ID` when reconnecting, but replay only works if the server retains event history and reads from that position. If an order status page needs only the latest state, a design that does not replay every intermediate state is also possible. Features that must process every event without omission, such as payment audits or shipment instructions, must not consume such a latest-state stream.

## A Latest Order Status Source That Cooperates with Cancellation

The following `src/orders/order-status-feed.ts` is a **complete local experiment file**. It stores only the current snapshot of one order and delivers the latest version to slow consumers. Skipping intermediate versions is an explicit part of its contract. This is not an API for changing production order state; it is an in-memory fixture reproducing observation of `paid -> fulfilling -> shipped`, and it makes no payment, shipping, or infrastructure changes.

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@fluojs/http';

export interface OrderSnapshot {
  id: string;
  customerId: string;
  status: 'paid' | 'fulfilling' | 'shipped';
  currency: 'KRW';
  totalMinor: string;
  version: number;
}

export class OrderStatusFeed {
  private current: OrderSnapshot = {
    id: 'order-1', customerId: 'account-1', status: 'paid',
    currency: 'KRW', totalMinor: '25000', version: 2,
  };
  private readonly listeners = new Set<() => void>();

  get activeSubscribers(): number {
    return this.listeners.size;
  }

  readFor(orderId: string, subject: string): OrderSnapshot {
    if (orderId !== this.current.id) {
      throw new NotFoundException('Order not found.');
    }
    if (subject !== this.current.customerId) {
      throw new ForbiddenException('Order access denied.');
    }
    return { ...this.current };
  }

  advance(status: 'fulfilling' | 'shipped'): void {
    const allowed =
      (this.current.status === 'paid' && status === 'fulfilling') ||
      (this.current.status === 'fulfilling' && status === 'shipped');
    if (!allowed) {
      throw new ConflictException('Invalid fixture transition.');
    }
    this.current = { ...this.current, status, version: this.current.version + 1 };
    for (const listener of this.listeners) listener();
  }

  async *watch(signal: AbortSignal): AsyncGenerator<OrderSnapshot, void> {
    let seenVersion = -1;
    let release: (() => void) | undefined;
    const wake = () => {
      release?.();
      release = undefined;
    };
    this.listeners.add(wake);
    signal.addEventListener('abort', wake, { once: true });

    try {
      while (!signal.aborted) {
        const snapshot = this.current;
        if (snapshot.version !== seenVersion) {
          seenVersion = snapshot.version;
          yield { ...snapshot };
          continue;
        }
        const gate = Promise.withResolvers<void>();
        release = gate.resolve;
        if (signal.aborted || this.current.version !== seenVersion) wake();
        await gate.promise;
      }
    } finally {
      this.listeners.delete(wake);
      signal.removeEventListener('abort', wake);
      release = undefined;
    }
  }
}
```

The key is not the `while` loop itself but how it waits. By installing a change listener first and then checking the current version, it can read the latest state even if that state arose before subscription. It waits on the gate only when there is nothing more to read, and both change and abort invoke the same wake function. After waking, it checks the current snapshot and version again rather than taking one event from a queue. This prevents the queue length from growing without bound according to the customer's consumption speed.

This approach trades away history delivery. If two state changes occur before the consumer's next read, the consumer receives only the final version. The order page can redraw with the latest state, but business processing such as "issue a shipping label when fulfilling arrives" must not be connected to this source. The snapshot is also prepared in its public representation, so no raw bigint reaches SSE's `JSON.stringify()`. Do not assume `SerializerInterceptor` automatically processes every stream element.

The abort listener wakes the pending gate. Without it, merely calling the async generator's `return()` does not automatically interrupt an in-progress `await gate.promise`. The generator processes the pending `next()` and termination request in order, so cleanup can also wait behind a read that never ends. The source must cooperate with cancellation so that the dispatcher can await iterator cleanup and then release request scope.

## Propagating HTTP Connection Closure to the Source

The following is the **complete experimental module file** `src/orders/order-events.module.ts`. It registers `OrderStatusFeed` from the previous file and checks order ownership using the existing account subject. It assumes the existing authentication layer sets the principal; do not register this module alongside the production orders module. The isolated experiment's `src/app.ts` composes its root with `@Module({ imports: [OrdersModule] })`.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  Controller, FromQuery, RequestDto, Sse, UnauthorizedException,
  type RequestContext, type SseMessage,
} from '@fluojs/http';
import { IsDefined, IsString, MinLength } from '@fluojs/validation';
import { OrderStatusFeed, type OrderSnapshot } from './order-status-feed.js';

class OrderEventsInput {
  @FromQuery('orderId')
  @IsDefined()
  @IsString()
  @MinLength(1)
  orderId = '';
}

@Inject(OrderStatusFeed)
@Controller('/orders')
class OrdersEventsController {
  constructor(private readonly feed: OrderStatusFeed) {}

  @Sse('/events')
  @RequestDto(OrderEventsInput)
  events(
    input: OrderEventsInput,
    context: RequestContext,
  ): AsyncIterable<SseMessage<OrderSnapshot>> {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    this.feed.readFor(input.orderId, principal.subject);

    const feed = this.feed;
    const stream = context.response.stream;
    if (!stream) throw new Error('Streaming adapter required.');
    const upstream = context.request.signal;

    return (async function* () {
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(upstream?.reason);
      upstream?.addEventListener('abort', forwardAbort, { once: true });
      const removeClose = stream.onClose?.(() => {
        controller.abort(new Error('Response stream closed.'));
      });
      if (upstream?.aborted || stream.closed || context.request.isAborted?.()) {
        controller.abort(new Error('Request already aborted.'));
      }
      try {
        for await (const snapshot of feed.watch(controller.signal)) {
          yield {
            event: 'order',
            id: String(snapshot.version),
            data: snapshot,
          };
        }
      } finally {
        upstream?.removeEventListener('abort', forwardAbort);
        removeClose?.();
      }
    })();
  }
}

@Module({
  controllers: [OrdersEventsController],
  providers: [OrderStatusFeed],
  exports: [OrderStatusFeed],
})
export class OrdersModule {}
```

Authentication and ownership checks execute before the generator is returned. If the first check happens inside the generator body, the error may occur after the dispatcher creates the SSE response and commits its headers. A normal JSON 401 or 403 can no longer be written at that point. That is why we check before the response starts and pass only the source's values into the streaming phase.

The wrapper forwards both the request signal and raw response stream close to a local controller, because some adapters may observe the response consumer's termination first. The dispatcher cancelling its own wait and waking the application source's pending read are separate operations, so this connection is explicit. Both listeners are removed during cleanup so that closures from finished requests do not remain.

The long wait in this example requires an adapter capable of delivering events. A custom host that provides only an instantaneous probe, with neither a signal nor raw `onClose`, cannot guarantee immediately waking a source already waiting. Add the required capability to such a host, or use short-lived queries instead of long-running SSE. Do not introduce hidden periodic polling of the probe as though it were part of the common contract.

## A Slow Consumer Is Not a Failed Consumer

A false return from `FrameworkResponseStream.write()` does not mean "discard this frame." It signals that the producer is writing faster than the receiving side and must await `waitForDrain()`. Managed SSE performs this wait; if cancellation arrives first, it does not continue waiting on a drain that remains pending forever. Request abort and raw stream close apply to drain waits as well as iterator reads.

The dispatcher's cleanup order matters. Once it observes cancellation, it closes the response stream, calls the source iterator's `return()`, and awaits that cleanup. Request finish and scope disposal follow. Disposing of scope before awaiting `return()` could leave the source's finally accessing request resources that have already closed. Conversely, if an uncooperative source never finishes cleanup, the dispatcher cannot magically stop the original operation.

A thrown write error or rejected drain must not be hidden as normal connection cancellation. The current managed SSE path preserves the original write or drain error even if abort arrives later, forwarding it to observers and logging boundaries. A JSON error envelope cannot be appended to an already committed stream. The original error remains in server logs, while the client responds through its stream interruption and reconnection policy.

Code that repeatedly calls manual `SseResponse.send()` must handle false results itself. With many values, letting a managed iterable handle flow control is simpler. If a particular library supports only callback-based push, however, the application must own a bounded queue, an overflow policy, unsubscribe, and close. Saying "the SSE helper automatically handles backpressure too" does not fit the manual path.

## Testing a Waiting Source and Skipped Intermediate Versions

The following `src/orders/order-status-feed.test.ts` is a **complete test file**. After confirming through the first read that the subscription is installed, it creates a pending read and aborts. The second test fixes the chosen behavior of delivering only the latest snapshot to a slow consumer. Neither relies on elapsed time instead of actual events.

```ts
import { expect, it } from 'vitest';
import { OrderStatusFeed } from './order-status-feed.js';

it('releases a pending read and removes its subscription on abort', async () => {
  const feed = new OrderStatusFeed();
  const controller = new AbortController();
  const iterator = feed.watch(controller.signal);
  expect((await iterator.next()).value).toMatchObject({ version: 2, status: 'paid' });
  expect(feed.activeSubscribers).toBe(1);

  const pending = iterator.next();
  controller.abort(new Error('Client disconnected.'));
  expect(await pending).toMatchObject({ done: true });
  expect(feed.activeSubscribers).toBe(0);
}, 1_000);

it('delivers the latest snapshot rather than an unbounded event history', async () => {
  const feed = new OrderStatusFeed();
  const controller = new AbortController();
  const iterator = feed.watch(controller.signal);
  await iterator.next();
  feed.advance('fulfilling');
  feed.advance('shipped');
  expect((await iterator.next()).value).toMatchObject({
    version: 4, status: 'shipped',
  });
  controller.abort();
  expect(await iterator.next()).toMatchObject({ done: true });
  expect(feed.activeSubscribers).toBe(0);
}, 1_000);
```

```bash
pnpm exec vitest run src/orders/order-status-feed.test.ts
```

The expected results are termination of the pending read, a subscriber count of 0, and observation of the latest version 4 rather than version 3. The actual HTTP drain contract can be read separately in the repository's `dispatcher-sse-backpressure-cancellation.test.ts`. That test creates a fixture in which `write()` returns false and drain never finishes, awaits a promise marking drain entry, and then triggers abort or raw close. The observations are one stream close, one iterator cleanup, and one request-scope disposal.

This source test alone does not verify disconnections through an actual browser or proxy. The test commands in this chapter are also reproduction steps for the reader, not results of execution during writing. In production verification, open a connection, receive the first `order` event, and then explicitly close it to observe whether the server's subscriber count and active request count fall. Waiting an arbitrary interval before the first event arrives and then closing may test only a request closed before any subscription was established.

## Uploads Have the Same Lifetime Problem

This problem is not limited to the response direction. If the connection drops during a multipart upload of a blog cover image or shop product photo, the input stream also needs disposal. The runtime's `parseMultipartStream()` iterates field and file parts and provides a file's `ReadableStream<Uint8Array>`. Fully consume or cancel a file before proceeding to the next part. Stopping partway through a file and asking only for the next part violates the parser's single-consumer boundary.

Do not mix buffered `parseMultipart()` and streaming `parseMultipartStream()` on the same body. Attempting to consume an already selected body again in another mode is rejected with `MultipartBodyConsumedError`. Stream mode still needs file, field, header, count, and cumulative byte limits; while bytes are being read, limits and abort dispose of the active source. The word streaming is not an alternative to size limits.

If a file that failed partway through reading remains in temporary storage, cleanup of that storage belongs to the application. The parser cancelling a network source and removing an incomplete upload from external object storage are different facts. This chapter does not run a file store or actual upload; it applies the same ownership questions to streams in both directions.

## Connecting Connection Closure to Application Shutdown

`Application.close()` from Chapter 9 synchronously blocks new direct dispatches, but that admission gate does not retroactively cancel requests already passed to the dispatcher. Existing requests and stream drain belong to the relevant dispatcher and adapter boundaries. The fact that new work can be rejected once shutdown begins, even while the public application state is still ready, also continues to apply.

With requests such as SSE that have no predetermined end, you need to understand the host shutdown deadline and forced connection termination policy. One universal lifecycle hook cannot explain this. On a Fetch host in particular, the point when a native `Response` is ready differs from the point when stream consumption ends. The runtime web contract's distinction between response and completion also expresses this lifetime. Do not transplant an independent Node listener's close procedure directly into an environment such as Next.js, where the host owns the server.

The browser's built-in `EventSource` cannot set arbitrary Authorization headers. To reuse existing account authentication, align the selected authentication method, such as a same-origin cookie, with the CORS policy. Explaining that a bearer header is added is not enough to complete a browser example. In a separate design using a signed query, control where the URL can appear in logs as well.

Verify proxy buffering, compression, and idle timeouts through the real surface too. Even though `SseResponse` sets no-cache, no-transform, and buffering-related headers, not every intermediary follows them in the same way. If you add a heartbeat to the latest-snapshot source, the same owner must handle creating and cancelling its timer. This example does not implement a heartbeat, so it makes no claim about keeping long-idle connections alive.

An order can remain after a connection drops, an external operation can continue after a request ends, and a stream can remain alive after a response is returned. Distinguishing cancellation signals, pending read settlement, iterator cleanup, request finish, and host drain makes it clear where to look for leftover resources. The next chapter compares the native primitives that different Node.js adapters use to implement this common HTTP contract.

## Sources and Verification Evidence

- [SSE and cancellation contracts in the HTTP README](../../packages/http/README.md), [common stream and request types](../../packages/http/src/types.ts)
- [SseResponse and frame encoder](../../packages/http/src/context/sse.ts), [managed SSE dispatcher](../../packages/http/src/dispatch/dispatcher.ts)
- [Backpressure cancellation regression tests](../../packages/http/src/dispatch/dispatcher-sse-backpressure-cancellation.test.ts), [ordinary request cancellation tests](../../packages/http/src/dispatch/dispatcher-cancellation.test.ts)
- [Manual SSE lifecycle tests](../../packages/http/src/dispatch/dispatcher-manual-sse-lifecycle.test.ts)
- [Runtime README](../../packages/runtime/README.md), [abort helper](../../packages/runtime/src/abort.ts), [abort tests](../../packages/runtime/src/abort.test.ts)
- [Active request tracking](../../packages/runtime/src/request-transaction.ts), [Web response and completion boundary](../../packages/runtime/src/web.ts)
- [Multipart implementation](../../packages/runtime/src/multipart.ts), [HTTP runtime contract](../../docs/architecture/http-runtime.md)

The evidence is the current source and related tests. Running the chapter's fixtures, actual network disconnections, proxy behavior, host-specific drain, and upload storage cleanup are not within the scope claimed to have passed during work on this manuscript.
