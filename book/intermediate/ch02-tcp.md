<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.1.0 -->

# 2. TCP Transport

TCP (Transmission Control Protocol) is the simplest and most common transport protocol for microservices.

In fluo, the TCP transport provides a high-performance, point-to-point communication channel using newline-delimited JSON (NDJSON) over raw sockets.

This chapter explores how to set up, secure, and scale services using the TCP transport within the **FluoShop** project.

Chapter 1 defined the service map. Chapter 2 turns that abstract map into the first real service link. We choose TCP first because it keeps the system understandable. There is no broker to operate, no consumer groups to reason about, and only one sender, one receiver, and a clear request-response story. That simplicity makes TCP an excellent baseline, and it also reveals the limits that later transports must solve.

## 2.1 Setting up a TCP Microservice

Starting a microservice with TCP is straightforward.

In the **FluoShop** architecture, we treat TCP as the primary link for internal, latency-critical read operations. Specifically, the API Gateway needs a direct, high-speed path to the Catalog Service to fetch product details before rendering a page. By using TCP, we avoid the overhead of a middle-man broker for these simple request-response pairs.

You configure the `TcpMicroserviceTransport` inside the `MicroservicesModule`.

The transport binds a host and port, opens a server socket during bootstrap, and begins accepting framed packets from clients.

In FluoShop, the first service we expose over TCP is the Catalog Service because catalog reads are frequent, latency-sensitive, and easy to reason about.

### 2.1.1 Server Configuration

To make a service accessible via TCP, bind it to a host and port.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';
import { CatalogHandler } from './catalog.handler';

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({
        host: '0.0.0.0',
        port: 4000,
      }),
    }),
  ],
  providers: [CatalogHandler],
})
export class CatalogModule {}
```

In this setup, the Catalog Service acts as a TCP server. fluo manages the server lifecycle, opening the port during bootstrap and gracefully closing it during shutdown. That lifecycle integration matters in development and production because it removes the need for custom socket boot code in development and gives the framework one place to coordinate cleanup in production. That is especially helpful once health checks, deployments, and rolling restarts are involved. When a service instance starts up, the transport doesn't just open a port; it coordinates with the fluo runtime to ensure handlers are ready before traffic arrives. This prevents "connection refused" or "unhandled message" errors during the split-second of service startup.

A few configuration choices deserve attention.

- `host` determines the network interface exposure. Binding to `0.0.0.0` is standard for containerized environments like Docker or Kubernetes.
- `port` defines the service contract for callers. In FluoShop, we consistently use `4000` for the internal Catalog interface.
- the provider list defines which handlers are discoverable. Handlers must use the `@MessagePattern` or `@EventPattern` decorators to receive TCP traffic.

The transport itself should stay thin.

Business validation belongs in handlers and domain services, not in socket bootstrap code.

## 2.2 Communicating Between Services

To call a TCP-based service from another part of the system, such as the API Gateway, you use fluo's `Microservice` client interface. In FluoShop, the API Gateway acts as the entry point. It receives HTTP requests from the public internet and translates them into internal TCP messages, and this translation layer is where service discovery or load balancing handoff typically happens. The client is intentionally small and does not try to hide the fact that you are making a network call. Instead, it gives you a predictable way to send a pattern plus payload and then await either a reply or an error.

### 2.2.1 Injecting the Client

The `MICROSERVICE` token provides access to the transport instance configured in the module.

```typescript
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';

export class CatalogClient {
  constructor(
    @Inject(MICROSERVICE) private readonly client: Microservice
  ) {}

  async getProduct(productId: string) {
    return await this.client.send('catalog.get', { productId });
  }
}
```

The `send()` method handles the request-reply correlation. The caller does not manually manage request IDs, socket listeners, or pending promise maps, and the framework does that work so that the calling code stays focused on the domain action. Internally, fluo generates a unique `requestId`, serializes the payload into an NDJSON frame, and sets up a one-time listener on the socket for the corresponding response. If the response doesn't arrive within the timeout window, the promise is rejected automatically. This does not make the call local. It remains a remote operation with all the usual network concerns, which means the caller should still think about timeout budgets, fallback behavior, and what happens when the remote service is unavailable. In FluoShop, if the Catalog Service is slow, the Gateway shouldn't hold the user's browser connection open indefinitely, so we set a strict `requestTimeoutMs` on the client side to ensure fast failure.

In FluoShop, the API Gateway uses this style for read-heavy catalog lookups.

The order path can also begin with TCP while the system is still simple.

Later, we will move more failure-sensitive workflows onto durable transports.

## 2.3 Delivery Safety and Constraints

TCP is a reliable transport, but it does not provide message persistence.

If the target service is down, the message cannot be durably stored in transit for later processing.

That makes TCP excellent for online request paths and weaker for workflows that must survive service restarts.

fluo adds safety layers so that basic TCP communication does not become operationally reckless.

### 2.3.1 Frame Size Limits

By default, fluo limits TCP frames to 1 MiB.

This prevents a single malicious or oversized request from exhausting the service's memory.

If a packet exceeds this limit, fluo closes the socket immediately to protect the process.

This limit is not just a security detail; it is also an architectural hint. If your service regularly approaches the 1 MiB ceiling, the problem is usually in the contract design. You may be sending binary data through the wrong channel, because TCP is for signaling and small data transfer, while large images or PDFs should be handled via object storage (like S3) with the TCP message only carrying the URI. You may be over-fetching, because returning a list of 10,000 products in a single TCP frame is a recipe for high latency and memory pressure. You may also be pushing batch behavior into a synchronous link that should stay narrow. For FluoShop, catalog lookups should remain small: identifiers, product metadata, and availability flags fit naturally into the frame boundary, but large media assets do not.

### 2.3.2 Timeouts and Retries

Since TCP is point-to-point, the caller depends on the availability of the receiver.

You can configure request timeouts to prevent the gateway from hanging indefinitely.

```typescript
new TcpMicroserviceTransport({
  port: 4000,
  requestTimeoutMs: 5000,
})
```

A timeout is a business decision as much as a technical one. Too short, and you amplify transient latency spikes into user-visible failures; for example, a 50ms garbage collection pause in the Catalog Service could trigger a 100ms timeout in the Gateway. Too long, and you consume resources while waiting for a response that is no longer useful. If a user expects a page in 2 seconds, a 10-second TCP timeout is effectively a crash from the user's perspective. Retries are equally context-sensitive. For idempotent reads, such as `catalog.get`, retries are usually safe, so if the first attempt times out, the Gateway can try again immediately. For state-changing operations, such as `order.place`, retries without idempotency guards can duplicate work and might end up charging the customer twice. That is why this chapter introduces TCP primarily through catalog reads: they are the cleanest example of where the transport shines.

## 2.4 Understanding NDJSON Framing

fluo's TCP transport uses Newline-Delimited JSON (NDJSON) for framing.

Each JSON object is followed by a `\n` character.

This is a standard and lightweight way to stream multiple JSON objects over a single socket.

```json
{"kind":"message","pattern":"catalog.get","payload":{"productId":"123"},"requestId":"abc-123"}\n
```

On the receiving side, fluo buffers incoming data until it encounters a newline.

At that point, it parses the buffered bytes as JSON and dispatches the packet to the appropriate handler. This mechanism is visible in `TcpMicroserviceTransport.bindSocketParser`, where the buffer is sliced at each `\n`. If a single line exceeds the `maxFrameBytes` (1 MiB), the socket is destroyed to prevent a memory-exhaustion attack.

The advantages are straightforward.

- The framing format is easy to inspect. You can debug the service using `telnet` or `nc` (netcat).
- Local debugging is simple with standard socket tools.
- The protocol overhead is low compared to HTTP/1.1 or bulky SOAP envelopes.

The trade-offs are equally important.

- Payloads must remain text-friendly JSON.
- Newline-delimited framing assumes packet bodies are serialized cleanly.
- The transport is optimized for internal service traffic, not arbitrary internet-facing clients.

For FluoShop, NDJSON is a pragmatic choice.

It matches the early stage of the system.

We care more about clarity and low operational overhead than about the richer features of a broker.

## 2.5 Error Handling in TCP

When a remote handler throws an error, the TCP transport captures the error message and sends it back to the caller in an error frame.

```json
{"requestId":"abc-123","error":"Product not found"}\n
```

The `client.send()` method then rejects the promise with a corresponding error, which allows you to handle remote failures with the same control-flow style you use for local exceptions. Even so, a remote error should be treated differently from a validation error in the same process, and the caller should ask at least three questions.

- Did the remote service reject the request on purpose? (e.g., "Invalid product ID")
- Did the network fail before the request completed? (e.g., "Connection reset by peer")
- Should the gateway expose the raw message to the client?

In FluoShop, the gateway should map transport-level failures into stable API-facing errors.

That preserves a clean boundary.

Clients should not need to know whether a missing product came from a remote TCP handler or from an in-process function.

## 2.6 Scaling TCP Services

Since TCP is a point-to-point protocol, scaling usually involves a load balancer or service discovery layer.

In a modern environment, the API Gateway doesn't connect to a single IP address. It connects to a stable DNS name provided by the infrastructure.

- **Kubernetes Service**: A `ClusterIP` service provides a single IP that load-balances across multiple Catalog pods.
- **Service Mesh**: Tools like Istio or Linkerd can handle retries and mTLS at the sidecar level.
- **Classic Proxy**: NGINX or HAProxy can act as a TCP-level proxy (Layer 4 load balancing).

Client-side load balancing is also possible, but it increases application complexity.

Operationally, TCP scaling raises questions that a broker would otherwise answer.

- How do clients discover healthy instances?
- How do you drain traffic during deploys? When a Catalog pod is shutting down, it must stop accepting new TCP connections but finish processing existing ones.
- How do you avoid reconnect storms? If the Catalog cluster restarts, thousands of Gateway connections might try to reconnect simultaneously.

These are solvable problems. They are simply outside the core transport abstraction. For early FluoShop phases, that is acceptable because the point is to keep the first distributed link understandable. As the system grows, we will introduce transports that move some of this coordination into infrastructure.

## 2.7 FluoShop Implementation: Gateway and Catalog

In FluoShop, we use TCP for the high-traffic link between the API Gateway and the Catalog Service.

1. **Catalog Service**: Implements the `catalog.get` pattern to return product metadata. It listens on port 4000.
2. **API Gateway**: Forwards incoming `/products/:id` HTTP requests to the Catalog Service via the TCP transport.

This setup provides the lowest practical overhead for product lookups, which are among the most frequent operations in the system. It also creates a clean example of request-response microservice communication. When a customer opens a product page, the gateway does not need durable event delivery; it needs a fast answer. If the catalog service is unavailable, the request should fail quickly and visibly, and that is exactly the sort of interaction TCP models well. This chapter therefore advances the FluoShop state from architecture-only to a concrete service connection. The next chapter will add decoupled, reliability-focused communication on top of that baseline.

## 2.8 Summary

- **Simplicity**: TCP is easy to set up and requires no external broker.
- **Low Latency**: NDJSON over raw sockets minimizes overhead for internal communication.
- **Synchronous Logic**: Use `send()` for critical request-response flows where immediate results are needed.
- **Safety Boundaries**: fluo's 1 MiB frame limit protects services from memory-based abuse by closing the socket on overflow.
- **Point-to-Point**: TCP requires the target service to be reachable at a known address or via a load balancer.
- **Progression**: In FluoShop, TCP establishes the first live link between the gateway and catalog domains.

The most important lesson is not that TCP is always best.

It is that TCP is best when its limitations match the problem.

We are using it where direct reachability, fast failure, and low latency make sense.

We are not using it where durability and asynchronous recovery will soon matter more.

## 2.9 Next Chapter Preview

In the next chapter, we will introduce Redis as a message broker to handle asynchronous events and durable communication.

That will change the character of the system.

Instead of asking only, "Can service A reach service B right now?"

we will also ask, "Can this workflow survive delay, replay, and consumer failure?"

That shift is what turns FluoShop from a simple set of service calls into a more resilient distributed application.
