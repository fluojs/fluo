<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.1.0 -->

# Chapter 2. TCP Transport

This chapter explains how to set up and operate the TCP transport for FluoShop's first real service connection. Chapter 1 gave us the architecture map. Now we implement that boundary as the simplest request/response link, giving us a baseline to compare against the broker-based chapters that follow.

## Learning Objectives
- Learn how to configure a TCP microservice with `TcpMicroserviceTransport`.
- Implement an inter-service request/response flow with the `MICROSERVICE` token and `send()`.
- Understand how NDJSON framing is used for TCP-based message delivery.
- Analyze why frame size limits and timeouts matter for TCP operational safety.
- Explain why TCP fits the Gateway-to-Catalog connection in FluoShop.

## Prerequisites
- Completion of Chapter 1.
- A basic understanding of Node.js socket communication and the request/response pattern.
- Familiarity with TypeScript asynchronous processing and `async`/`await` syntax.

## 2.1 Setting up a TCP Microservice

Starting a microservice over TCP is straightforward. **FluoShop** uses TCP as the default connection for internal, latency-sensitive read operations. The API Gateway needs to fetch product details before rendering a page, so it needs a direct, fast path to the Catalog Service. TCP avoids the overhead of passing through a middle-man broker for this simple request/response pair. Configure `TcpMicroserviceTransport` inside `MicroservicesModule`. This transport binds to a host and port, opens the server socket during bootstrap, and starts receiving framed packets from clients. In FluoShop, we expose the Catalog Service over TCP first. Catalog lookups are frequent, latency-sensitive, and the clearest path for explaining the request/response model.

### 2.1.1 Server Configuration

To make the service reachable over TCP, bind it to a host and port.

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

With this configuration, the Catalog Service acts as a TCP server. fluo manages the server lifecycle, opening the port during bootstrap and closing it safely on shutdown. This integration matters in both development and production. During development, you don't need separate socket boot code. In production, the framework can coordinate cleanup in one place. The value of this structure becomes clearer once health checks, deployments, and rolling restarts enter the picture. When a service instance starts, the transport doesn't just open a port. It works with the fluo runtime to confirm that handlers are ready before traffic arrives. This reduces the `connection refused` or `unhandled message` errors that can happen right after service startup.

A few configuration values deserve special attention.

- `host` decides which network interface to expose. In container environments such as Docker or Kubernetes, binding to `0.0.0.0` is common.
- `port` defines the service contract callers expect. FluoShop consistently uses port `4000` for Catalog's internal interface.
- The provider list decides which handlers can be discovered. Handlers must use the `@MessagePattern` or `@EventPattern` decorator to receive TCP traffic.

It's best to keep the transport itself thin. Business validation should live in handlers and domain services, not in socket boot code.

## 2.2 Communicating Between Services

To call a TCP-based service from another part of the system, such as the API Gateway, use fluo's `Microservice` client interface. In FluoShop, the API Gateway is the entry point. It receives HTTP requests from the public internet and translates them into internal TCP messages. This translation layer is also where service discovery or load balancing handoff usually happens. The client is intentionally small and simple, and it doesn't hide the fact that this is a network call. Instead, it lets you send a pattern and payload, then wait for a response or error in a predictable way.

### 2.2.1 Injecting the Client

The `MICROSERVICE` token gives you access to the transport instance configured in the Module.

```typescript
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';

@Inject(MICROSERVICE)
export class CatalogClient {
  constructor(private readonly client: Microservice) {}

  async getProduct(productId: string) {
    return await this.client.send('catalog.get', { productId });
  }
}
```

The `send()` method handles request/response correlation. Callers don't need to manage request IDs, socket listeners, or maps of pending promises themselves. The framework handles that work, so calling code can stay focused on domain behavior. Internally, fluo creates a unique `requestId`, serializes the payload as an NDJSON frame, and sets a one-time listener on the socket for the matching response. If the response doesn't arrive within the timeout window, the promise is rejected automatically. That doesn't make this call a local function call. It's still a network call, and callers must design for timeout budgets, fallback behavior, and remote service unavailability. If the Catalog Service slows down in FluoShop, the Gateway shouldn't hold the user's browser connection indefinitely. That is why we set a strict client-side `requestTimeoutMs` to guarantee fast failure. In FluoShop, the API Gateway performs read-heavy catalog lookups this way. Order paths can also start on TCP while the system is simple. Later, though, workflows that are more sensitive to failure move to a durable transport.

## 2.3 Delivery Safety and Constraints

TCP is a reliable transport, but it doesn't provide message durability. If the target service is down, the message can't be safely stored in the middle and processed later. That makes TCP good for online request paths, but weak for workflows that must survive service restarts. fluo adds safeguards so basic TCP communication doesn't become operationally reckless.

### 2.3.1 Frame Size Limits

By default, fluo limits TCP frame size to 1 MiB. This limit prevents a single malicious or excessively large request from exhausting service memory. If a packet exceeds this limit, fluo immediately closes the socket to protect the process. This limit is more than a security detail. It's also an architectural hint. If a service often approaches the 1 MiB limit, the problem is usually in the contract design. You may be sending binary data through the wrong channel. TCP is meant for signaling and small data transfer, so large images or PDFs should be handled through object storage, such as S3, while TCP messages carry only the URI. You may also be querying too much data at once. Returning a list of 10,000 products in a single TCP frame causes high latency and memory pressure. Or you may be forcing batch-like behavior into a contract that should stay on a synchronous link. FluoShop catalog lookups should be small and predictable. Identifiers, product metadata, and inventory flags fit naturally inside frame boundaries, but large media assets do not.

### 2.3.2 Timeouts and Retries

Because TCP is point-to-point, the caller depends on receiver availability. Setting a request timeout keeps the gateway from waiting forever.

```typescript
new TcpMicroserviceTransport({
  port: 4000,
  requestTimeoutMs: 5000,
})
```

Timeouts are both a technical setting and a business decision. If they are too short, temporary latency spikes turn into user-visible failures. For example, if the Catalog Service has a 50 ms garbage collection pause but the Gateway timeout is 100 ms, normal variation may look like failure. If the timeout is too long, resources stay tied up waiting for a response that no longer matters. If users expect to see a page within 2 seconds but the TCP timeout is 10 seconds, the experience is effectively an outage from the user's point of view. Retries also depend on context. Idempotent reads such as `catalog.get` are usually safe to retry, so the Gateway can immediately try again if the first attempt times out. State-changing operations, such as `order.place`, can run twice without idempotency protection and may charge the customer twice. That is why this chapter introduces TCP mainly through catalog lookups. This is the path where the transport fits most naturally.

## 2.4 Understanding NDJSON Framing

fluo's TCP transport uses NDJSON for framing. Each JSON object is followed by a `\n` character. This is a standard, lightweight approach for streaming multiple JSON objects over a single socket.

```json
{"kind":"message","pattern":"catalog.get","payload":{"productId":"123"},"requestId":"abc-123"}\n
```

On the receiving side, fluo buffers incoming data until it sees a newline character. At that point, it parses the buffered bytes as JSON and dispatches the packet to the appropriate handler. You can see this mechanism in `TcpMicroserviceTransport.bindSocketParser`, where the buffer is split on each `\n`. If a single line exceeds `maxFrameBytes` (1 MiB), the socket is destroyed to prevent memory exhaustion attacks.

The benefits are clear.

- The framing format is easy to inspect directly. You can debug the service with tools such as `telnet` or `nc` (netcat).
- Local debugging is simple with standard socket tools.
- Protocol overhead is low compared with HTTP/1.1 or heavy SOAP envelopes.

The tradeoffs are clear too.

- The payload must be text-friendly JSON.
- Newline-delimited framing assumes clean body serialization.
- This transport is optimized for internal service traffic rather than arbitrary internet clients.

NDJSON is a practical choice for FluoShop. It fits the system's early stage. We value clarity and low operational cost more than the richer features of a broker for now.

## 2.5 Error Handling in TCP

When a remote handler throws an error, the TCP transport captures the error message and sends it back to the caller as an error frame.

```json
{"requestId":"abc-123","error":"Product not found"}\n
```

Then `client.send()` rejects the promise with that error, which lets you handle remote failures with a control flow style similar to local exceptions. Still, remote errors should be treated differently from validation errors inside the same process. Callers should ask at least three questions.

- Did the remote service intentionally reject the request? For example, "invalid product ID".
- Did the network fail before the request completed? For example, "Connection reset by peer".
- Is it safe for the gateway to show this raw message to an external client?

In FluoShop, the gateway should map transport-level failures to stable API errors. That keeps the boundary clean. The client doesn't need to know whether a missing product came from a remote TCP handler or a local function.

## 2.6 Scaling TCP Services

TCP is a point-to-point protocol, so scaling usually requires a load balancer or service discovery layer. In modern environments, the API Gateway doesn't connect to a single IP address. It connects to a stable DNS name provided by the infrastructure.

- **Kubernetes Service**: A `ClusterIP` service provides a single IP that load balances across multiple Catalog pods.
- **Service Mesh**: Tools such as Istio or Linkerd can handle retries and mTLS at the sidecar level.
- **Classic Proxy**: NGINX or HAProxy can act as a TCP-level proxy, which is Layer 4 load balancing.

Client-side load balancing is also possible, but it increases application complexity. From an operations point of view, scaling TCP usually brings back questions that a broker would answer for you.

- How does the client find a healthy instance?
- How do we drain traffic during a deployment? When a Catalog pod terminates, it should stop accepting new TCP connections while letting existing ones finish.
- How do we prevent reconnect storms? If the Catalog cluster restarts, thousands of Gateway connections may try to reconnect at the same time.

These problems are solvable. The important point is that they live outside the core transport abstraction. This is enough for FluoShop's early stage, because the priority is keeping the first distributed link understandable. As the system grows, we introduce transports where the infrastructure takes over some of this coordination.

## 2.7 FluoShop Implementation: Gateway and Catalog

In FluoShop, we use TCP for the high-traffic connection between the API Gateway and the Catalog Service.

1. **Catalog Service**: Implements the `catalog.get` pattern that returns product metadata. It listens on port 4000.
2. **API Gateway**: Forwards incoming `/products/:id` HTTP requests to the Catalog Service through the TCP transport.

This setup gives one of the system's most frequent operations, product lookup, low practical overhead. It also gives us a clear example of request/response microservice communication. When a customer opens a product page, the gateway doesn't need durable event delivery. It needs a fast response. If the catalog service is down, the request should fail quickly and clearly, and TCP models exactly that interaction. That is why this chapter moves FluoShop from architecture explanation to real service connection. The next chapter adds loosely coupled, reliability-oriented communication on top of this baseline.

## 2.8 Summary

- **Simplicity**: TCP is easy to configure and doesn't require an external broker.
- **Low Latency**: NDJSON over raw sockets minimizes internal communication overhead.
- **Synchronous Logic**: Use `send()` for request/response flows that need immediate results.
- **Safety Boundaries**: fluo's 1 MiB frame limit prevents memory-based abuse by closing the socket on overflow.
- **Point-to-Point**: TCP requires the target service to be reachable at a known address or through a load balancer.
- **Progression**: In FluoShop, TCP creates the first real connection between the gateway and catalog domain.

The most important lesson is not that TCP is always best. It is that TCP is best when its limits fit the problem. We use TCP where direct reachability, fast failure, and low latency matter. We don't use it yet in areas where durability and asynchronous recovery will matter more.

## 2.9 Next Chapter Preview

In the next chapter, we introduce Redis as a message broker for asynchronous events and durable communication. At that point, the system's character changes. We no longer ask only, "Can service A reach service B right now?" We also ask, "Can this workflow survive delay, replay, and consumer failure?" That shift turns FluoShop from a simple collection of service calls into a more resilient distributed application.
