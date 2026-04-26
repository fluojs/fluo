<!-- packages: @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 13. WebSocket Gateways

This chapter adds a realtime connection layer to FluoShop and explains the gateway model for delivering state changes without polling. Chapter 12 covered time-based coordination. Now we connect domain events and order flows to client connections to create a realtime surface.

## Learning Objectives
- Understand that a WebSocket gateway has a realtime contract that differs from request-response flows.
- Learn how to register a gateway-based realtime layer with `WebSocketModule.forRoot()`.
- Explain the responsibilities of the `@OnConnect`, `@OnMessage`, and `@OnDisconnect` lifecycle.
- Analyze why upgrade guards and bounded defaults matter for production stability.
- Map domain events into gateway messages and push them to clients.
- Explain which operational problems heartbeat, shared paths, and server-backed mode solve.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, and Chapter 12.
- A basic understanding of event-driven flows and persistent connections.
- Basic familiarity with authenticated client connections and realtime resource management.

## 13.1 The shift to real-time

In previous chapters, FluoShop relied on the request-response cycle. The user sends a command, the backend processes it, and the response confirms the result. When the user wants to check an update such as order shipment, they usually need to refresh the page or wait for a background polling script to call a GET endpoint, which is inefficient and creates unnecessary load. WebSockets change this contract by letting the client open a persistent connection while the server pushes updates as soon as they happen. In fluo, this transition is managed through a Gateway, so realtime connections still live inside an explicit application boundary.

## 13.2 WebSocket module wiring

To enable realtime features, register `WebSocketModule`. By default, fluo uses a Node.js-based runtime, but this package is designed to be runtime-agnostic so application code does not become tightly coupled to a specific engine.

```typescript
import { Module } from '@fluojs/core';
import { WebSocketModule } from '@fluojs/websockets';

@Module({
  imports: [WebSocketModule.forRoot()],
  providers: [OrderStatusGateway],
})
export class RealTimeModule {}
```

The `forRoot()` call initializes the default engine and prepares the framework to discover classes decorated with `@WebSocketGateway`. This step lets gateways be managed like normal providers in the Module graph, with their connection lifecycle handled inside fluo's application boundary.

## 13.3 Creating a gateway

A Gateway is a class that manages a specific realtime area. In FluoShop, order updates need a dedicated gateway, and keeping that gateway separate prevents order status messages from being mixed with unrelated realtime features.

```typescript
import { 
  WebSocketGateway, 
  OnConnect, 
  OnMessage, 
  OnDisconnect 
} from '@fluojs/websockets';

@WebSocketGateway({ path: '/orders/updates' })
export class OrderStatusGateway {
  @OnConnect()
  handleConnection(socket: any) {
    console.log('Client connected for order updates');
  }

  @OnMessage('subscribe')
  handleSubscription(payload: { orderId: string }, socket: any) {
    // Logic to link the socket to an order
  }

  @OnDisconnect()
  handleDisconnect(socket: any) {
    console.log('Client disconnected');
  }
}
```

The `@OnConnect`, `@OnMessage`, and `@OnDisconnect` decorators map directly to the WebSocket lifecycle. This structure follows the same line as the existing fluo handler model and uses the same declarative pattern as HTTP `@Get` and Event `@OnEvent` handlers. As a result, realtime connection code still reads like familiar fluo code.

## 13.4 Bounded defaults and guards

In production, you cannot leave WebSockets open without limits. WebSockets consume persistent server resources, namely memory and file descriptors. The `@fluojs/websockets` package automatically applies bounded defaults for concurrent connections and payload size, and you can tune these settings at the Module level. Starting from bounded defaults and adjusting only what the workload needs helps keep realtime features scalable and predictable.

```typescript
WebSocketModule.forRoot({
  limits: {
    maxConnections: 1000,
    maxPayloadBytes: 32_768, // 32KB
  },
  upgrade: {
    guard(request) {
      // Handshake-level security
      const token = request instanceof Request
        ? request.headers.get('authorization')
        : request.headers.authorization;

      if (!isValid(token)) throw new UnauthorizedException();
    }
  }
})
```

The `upgrade.guard` is especially important. This Guard runs before the WebSocket handshake completes, which makes it the right place for checks such as authentication or origin validation that must happen before the connection is accepted.

If the Guard fails, the connection is rejected immediately. It is a boundary that stops the server from allocating resources for unauthenticated clients.

## 13.5 Integrating with FluoShop events

A Gateway itself is closer to a pipe. To turn it into a useful realtime feature, you need to connect it to the FluoShop event bus. When an `OrderShippedEvent` occurs in the backend, the gateway should read that internal event and push a status-change message to the relevant client.

```typescript
import { OnEvent } from '@fluojs/events';
import { WebSocketGateway } from '@fluojs/websockets';

@WebSocketGateway({ path: '/orders/updates' })
export class OrderStatusGateway {
  private clients = new Map<string, any>();

  @OnMessage('watch')
  registerInterest(payload: { orderId: string }, socket: any) {
    this.clients.set(payload.orderId, socket);
  }

  @OnEvent('order.shipped')
  handleOrderShipped(event: OrderShippedEvent) {
    const socket = this.clients.get(event.orderId);
    if (socket) {
      socket.send(JSON.stringify({
        type: 'status_change',
        status: 'SHIPPED',
        timestamp: new Date()
      }));
    }
  }
}
```

This connection bridges the asynchronous domain and the real-time surface. The Gateway listens to internal events and transforms them into external socket messages, so domain logic does not need to know about socket details while clients still receive state changes immediately.

## 13.6 Cross-runtime websocket surfaces

fluo is designed around portability. The default `WebSocketModule` targets Node.js, but you may need to run FluoShop on Bun, Deno, or Cloudflare Workers. Each runtime handles WebSockets differently at the engine level, so the `@fluojs/websockets` package handles this difference through runtime-specific subpaths. Keeping runtime differences at the import boundary helps the gateway's business logic remain stable.

| Runtime | Subpath |
| --- | --- |
| Node.js | `@fluojs/websockets/node` |
| Bun | `@fluojs/websockets/bun` |
| Deno | `@fluojs/websockets/deno` |
| Workers | `@fluojs/websockets/cloudflare-workers` |

When you import from the correct subpath, the backend adapter can change to match the host environment while the gateway logic stays the same. In other words, portability is expressed through package boundaries and import choices, not only through a broad architectural promise.

## 13.7 Heartbeats and connection health

WebSockets can disconnect silently. Network interruptions or silent proxy timeouts can leave "ghost" connections on the server that are no longer reachable. In the Node-based adapter, fluo enables the heartbeat timer by default, and the server periodically sends a ping to the client. If the client does not respond within the configured time, fluo closes the socket and triggers the `@OnDisconnect` handler. This boundary protects the FluoShop backend from leaking memory because of thousands of dead connections.

## 13.8 Server-backed mode

Sometimes you need a WebSocket server that is independent from the main HTTP server. In fluo, this is called `serverBacked` mode, and it is useful when realtime traffic has different operational needs from the standard API.

```typescript
@WebSocketGateway({ 
  path: '/updates', 
  serverBacked: { port: 3101 } 
})
export class DedicatedGateway {}
```

This setting starts a dedicated listener on port 3101. It is useful when you need to isolate realtime traffic from standard API traffic and apply different load-balancing rules or firewall policies. Operators can then observe connection costs separately from normal request processing costs.

## 13.9 Shared path gateways

fluo supports multiple gateways sharing the same path. Even when they use the same connection surface, event names can split responsibilities across smaller feature-focused gateways.

```typescript
@WebSocketGateway({ path: '/realtime' })
export class ChatGateway {
  @OnMessage('chat')
  handleChat() {}
}

@WebSocketGateway({ path: '/realtime' })
export class MetricsGateway {
  @OnMessage('metrics')
  handleMetrics() {}
}
```

When a message arrives at the `/realtime` path, fluo routes it to the correct handler based on the event name. This lets you organize realtime logic into small, focused classes instead of one giant "God Gateway." Smaller classes also make tests and permission checks easier to separate by feature.

## 13.10 FluoShop v2.2.0 order flow

With WebSockets introduced, the order flow has a more direct realtime contract. The user sees the same order process, but status checks move from repeated polling to server push.

1. The customer places an order through a standard HTTP POST.
2. The frontend immediately opens a WebSocket to `/orders/updates`.
3. The backend processes the order and publishes domain events.
4. `OrderStatusGateway` listens to these events and pushes updates through the socket.
5. The customer sees "Processing", "Packed", and "Shipped" updates in real time without a single refresh.

This flow reduces repeated polling by users and gives them an experience where the backend responsibly pushes state changes. Because order processing and realtime delivery are connected through event boundaries, the two flows can still be tested and operated independently.

## 13.11 Summary

- `@fluojs/websockets` provides a decorator-based API for realtime communication.
- `WebSocketModule.forRoot()` initializes the engine with bounded defaults for production stability.
- `@WebSocketGateway` classes manage the connection lifecycle and message routing.
- You can use `upgrade.guard` to reject unauthenticated handshakes before they consume server resources.
- Runtime-specific subpaths ensure realtime logic stays portable across Node, Bun, Deno, and Cloudflare Workers.
- Heartbeat and bounded defaults prevent resource leaks and ghost connections.

The practical lesson is that WebSockets should be just as structured as REST APIs.

With Gateways and decorators, FluoShop can keep realtime logic clear and auditable while integrating tightly with the rest of the framework's event system.
