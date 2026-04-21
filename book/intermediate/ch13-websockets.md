<!-- packages: @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# 13. WebSocket Gateways

API requests and events describe what happened in the past.

WebSockets describe what is happening right now.

As FluoShop moves toward v2.2.0, the platform needs to bridge the gap between backend state changes and frontend user experiences without forcing the client to poll.

The `@fluojs/websockets` package provides a decorator-driven way to author WebSocket gateways that feel identical to the HTTP controllers and event handlers we have built so far.

It handles the complexity of the handshake, message routing, and disconnection cleanup across different JavaScript runtimes.

This chapter covers how to build a real-time order status gateway that keeps customers informed as their purchases move through the fulfillment pipeline.

## 13.1 The shift to real-time

In the previous chapters, FluoShop relied on a request-response cycle.

A user sends a command, the backend processes it, and the response confirms the result.

If the user wants to see an update—like an order being shipped—they usually have to refresh the page or wait for a background polling script to hit a GET endpoint.

This is inefficient and creates unnecessary load.

WebSockets change the contract.

The client opens a persistent connection, and the server pushes updates as soon as they occur.

In fluo, this transition is managed through Gateways.

## 13.2 WebSocket module wiring

To enable real-time features, we register the `WebSocketModule`.

By default, fluo uses a Node.js-backed runtime, but the package is designed to be runtime-agnostic.

```typescript
import { Module } from '@fluojs/core';
import { WebSocketModule } from '@fluojs/websockets';

@Module({
  imports: [WebSocketModule.forRoot()],
  providers: [OrderStatusGateway],
})
export class RealTimeModule {}
```

The `forRoot()` call initializes the underlying engine and prepares the framework to discover classes decorated with `@WebSocketGateway`.

## 13.3 Creating a gateway

A gateway is a class that manages a specific real-time surface area.

In FluoShop, we want a dedicated gateway for order updates.

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
    // Logic to link this socket to an order
  }

  @OnDisconnect()
  handleDisconnect(socket: any) {
    console.log('Client disconnected');
  }
}
```

The decorators `@OnConnect`, `@OnMessage`, and `@OnDisconnect` map directly to the WebSocket lifecycle.

This structure should feel familiar.

It follows the same declarative pattern used for HTTP `@Get` and Event `@OnEvent` handlers.

## 13.4 Bounded defaults and guards

In production, you cannot leave WebSockets completely open.

They consume persistent resources (memory and file descriptors) on the server.

The `@fluojs/websockets` package applies bounded defaults for concurrent connections and payload sizes automatically.

You can tune these at the module level.

```typescript
WebSocketModule.forRoot({
  limits: {
    maxConnections: 1000,
    maxPayloadBytes: 32_768, // 32KB
  },
  upgrade: {
    guard(request) {
      // Handshake-level security
      const token = request.headers.authorization;
      if (!isValid(token)) throw new UnauthorizedException();
    }
  }
})
```

The `upgrade.guard` is particularly important.

It runs before the WebSocket handshake completes.

If the guard fails, the connection is rejected immediately, saving the server from allocating resources for an unauthorized client.

## 13.5 Integrating with FluoShop events

A gateway by itself is just a pipe.

To make it useful, we connect it to the FluoShop event bus.

When an `OrderShippedEvent` occurs in the backend, the gateway should push a message to the relevant client.

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

This is the bridge between the asynchronous domain and the real-time surface.

The gateway listens to internal events and translates them into external socket messages.

## 13.6 Cross-runtime websocket surfaces

Fluo is built for portability.

While the default `WebSocketModule` targets Node.js, you may want to run FluoShop on Bun, Deno, or Cloudflare Workers.

Each runtime handles WebSockets differently at the engine level.

The `@fluojs/websockets` package solves this through runtime-specific subpaths.

| Runtime | Subpath |
| --- | --- |
| Node.js | `@fluojs/websockets/node` |
| Bun | `@fluojs/websockets/bun` |
| Deno | `@fluojs/websockets/deno` |
| Workers | `@fluojs/websockets/cloudflare-workers` |

By importing from the correct subpath, your gateway logic remains the same while the underlying adapter changes to match the host environment.

## 13.7 Heartbeats and connection health

WebSockets can die silently.

A network interruption or a silent proxy timeout can leave a "ghost" connection on the server that is no longer reachable.

For Node-based adapters, fluo enables heartbeat timers by default.

The server periodically sends a ping to the client.

If the client does not respond within a window, fluo closes the socket and triggers the `@OnDisconnect` handler.

This ensures the FluoShop backend does not leak memory over time from thousands of dead connections.

## 13.8 Server-backed mode

Sometimes you want a WebSocket server that is independent of your main HTTP server.

In fluo, this is called `serverBacked` mode.

```typescript
@WebSocketGateway({ 
  path: '/updates', 
  serverBacked: { port: 3101 } 
})
export class DedicatedGateway {}
```

This starts a dedicated listener on port 3101.

It is useful when you want to isolate real-time traffic from standard API traffic, perhaps to apply different load-balancing rules or firewall policies.

## 13.9 Shared path gateways

Fluo supports multiple gateways sharing the same path.

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

When a message arrives at `/realtime`, fluo routes it to the correct handler based on the event name.

This allows you to organize your real-time logic into small, focused classes instead of one giant "God Gateway."

## 13.10 FluoShop v2.2.0 order flow

With WebSockets implemented, the order flow is now truly modern:

1. The customer places an order via a standard HTTP POST.
2. The frontend immediately opens a WebSocket to `/orders/updates`.
3. The backend processes the order and emits domain events.
4. The `OrderStatusGateway` hears these events and pushes updates to the socket.
5. The customer sees "Processing", "Packed", and "Shipped" updates in real-time without a single refresh.

This creates a high-end experience that feels responsive and reliable.

## 13.11 Summary

- `@fluojs/websockets` provides a decorator-based API for real-time communication.
- `WebSocketModule.forRoot()` initializes the engine with bounded defaults for production safety.
- `@WebSocketGateway` classes manage the connection lifecycle and message routing.
- `upgrade.guard` allows you to reject unauthorized handshakes before they consume server resources.
- Runtime-specific subpaths ensure your real-time logic is portable across Node, Bun, and Deno.
- Heartbeats and bounded defaults prevent resource leaks and ghost connections.

The practical lesson is that WebSockets should be as structured as your REST APIs.

By using gateways and decorators, FluoShop keeps its real-time logic clean, auditable, and tightly integrated with the rest of the framework's event system.
