<!-- packages: @fluojs/socket.io, @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# 14. Advanced Socket.IO

Raw WebSockets are powerful, but they are a low-level primitive.

For complex real-time features like rooms, namespaces, and reliable broadcasting, the industry often turns to Socket.IO.

The `@fluojs/socket.io` package integrates Socket.IO v4 into the fluo ecosystem, allowing you to use the same gateway decorators while gaining the advanced features of the Socket.IO engine.

As FluoShop v2.2.0 evolves, we need a way to support multi-channel customer support chat.

Standard WebSockets would require us to manually manage groups of connections.

Socket.IO makes this trivial.

This chapter covers how to build a support chat system using rooms, namespaces, and runtime-specific optimizations.

## 14.1 Why Socket.IO for FluoShop?

While `@fluojs/websockets` (covered in Chapter 13) is excellent for simple streams like order updates, some features are difficult to implement correctly on raw sockets:

- **Rooms**: Broadcasting a message to all users in "Support Ticket #123".
- **Automatic Reconnection**: Handling flaky mobile networks without losing application state.
- **Namespaces**: Separating "Public Chat" from "Internal Admin Alerts" on a single connection.
- **Broadcasting**: Sending a message to everyone *except* the sender.

Socket.IO provides these as first-class concepts.

In FluoShop, we use Socket.IO to power our customer support portal, where every support ticket is a room and every department is a namespace.

## 14.2 Socket.IO module wiring

Registration follows the familiar fluo pattern, but with Socket.IO-specific configuration.

```typescript
import { Module } from '@fluojs/core';
import { SocketIoModule } from '@fluojs/socket.io';

@Module({
  imports: [
    SocketIoModule.forRoot({
      cors: {
        origin: ['https://fluoshop.com'],
      },
      engine: {
        maxHttpBufferSize: 1_048_576, // 1 MiB limit
      }
    }),
  ],
  providers: [SupportChatGateway],
})
export class ChatModule {}
```

By default, fluo keeps CORS in a deny-by-default posture (`origin: false`).

You must explicitly list your allowed origins to enable cross-origin browser clients.

The `engine` configuration maps directly to Engine.IO, allowing you to cap payload sizes for production safety.

## 14.3 Room management with SocketIoRoomService

Socket.IO's most powerful feature is room management.

In FluoShop, when a customer opens a support ticket, we want to join them to a room named after that ticket.

Instead of manipulating the socket object directly, fluo provides the `SOCKETIO_ROOM_SERVICE`.

```typescript
import { 
  WebSocketGateway, 
  OnConnect, 
  OnMessage 
} from '@fluojs/websockets';
import { 
  SOCKETIO_ROOM_SERVICE, 
  type SocketIoRoomService 
} from '@fluojs/socket.io';
import { Inject } from '@fluojs/core';

@WebSocketGateway({ path: '/support' })
export class SupportChatGateway {
  constructor(
    @Inject(SOCKETIO_ROOM_SERVICE)
    private readonly rooms: SocketIoRoomService
  ) {}

  @OnMessage('join_ticket')
  handleJoin(payload: { ticketId: string }, socket: any) {
    const roomName = `ticket:${payload.ticketId}`;
    this.rooms.joinRoom(socket.id, roomName);
  }

  @OnMessage('send_message')
  handleMessage(payload: { ticketId: string, text: string }) {
    const roomName = `ticket:${payload.ticketId}`;
    this.rooms.broadcastToRoom(roomName, 'new_message', {
      text: payload.text,
      sender: 'user',
    });
  }
}
```

The `SocketIoRoomService` abstracts the room logic away from the gateway.

It allows you to broadcast to rooms even from services that don't have access to the original socket instance.

## 14.4 Guarding namespaces and messages

Security in real-time systems often requires more granularity than simple handshake guards.

You may want to allow a connection to the `/support` namespace but only allow "send_message" if the user is authenticated.

`SocketIoModule.forRoot` supports explicit auth guards.

```typescript
SocketIoModule.forRoot({
  auth: {
    connection({ socket }) {
      // Namespace-level auth
      const token = socket.handshake.auth.token;
      return token === 'valid' ? true : { message: 'Auth failed' };
    },
    message({ event, payload }) {
      // Message-level auth
      if (event === 'admin_command' && !payload.isAdmin) {
        return { message: 'Unauthorized command' };
      }
      return true;
    }
  }
})
```

If these guards return anything other than `true`, the connection or message is rejected with a standardized Socket.IO error object.

## 14.5 Accessing the raw server

Sometimes you need to break the abstraction and access the underlying Socket.IO `Server` instance.

Perhaps you need to attach a custom adapter (like the Redis adapter for multi-node scaling) or listen to low-level server events.

You can inject the raw server using the `SOCKETIO_SERVER` token.

```typescript
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

export class ScalingService {
  constructor(
    @Inject(SOCKETIO_SERVER)
    private readonly io: Server
  ) {
    // Perform low-level server configuration
    console.log('Socket.IO Server instance available');
  }
}
```

This ensures that while fluo provides a clean decorator-based surface, you never lose the full power of the underlying library.

## 14.6 Bun engine details

Fluo has first-class support for Bun's high-performance WebSocket implementation.

Socket.IO normally uses the `ws` package on Node.js.

On Bun, it can use the `@socket.io/bun-engine`.

When you run FluoShop on Bun, the `@fluojs/socket.io` adapter automatically detects the environment and switches to the Bun engine if available.

This allows FluoShop to handle thousands of concurrent support chats with significantly lower memory overhead than a standard Node.js process.

## 14.7 Broadcasting to multiple rooms

In the FluoShop support portal, an agent might need to broadcast a global announcement to all active tickets.

```typescript
@OnMessage('global_announcement')
handleAnnouncement(payload: { message: string }) {
  // Broadcast to multiple rooms at once
  this.rooms.broadcastToRoom(['ticket:active', 'staff:updates'], 'announcement', {
    text: payload.message
  });
}
```

The `broadcastToRoom` method accepts either a single string or an array of strings.

This matches the native Socket.IO behavior but through a clean, injectable service interface.

## 14.8 Handling volatile messages

Sometimes you want to send a message that is only useful *right now*.

If the client is temporarily disconnected, you don't want them to receive the message when they reconnect (which is what Socket.IO's default buffering does).

Examples in FluoShop include "User is typing" indicators or live cursor positions in a collaborative dashboard.

The `SocketIoRoomService` allows you to send volatile messages that are discarded if the client is not reachable.

## 14.9 Testing Socket.IO gateways

Because fluo gateways are just classes, they are easy to test.

You can mock the `SocketIoRoomService` to verify that your gateway joins the correct rooms and broadcasts the expected events without ever spinning up a real network socket.

```typescript
describe('SupportChatGateway', () => {
  it('should join the correct ticket room', () => {
    const mockRoomService = { joinRoom: vi.fn() };
    const gateway = new SupportChatGateway(mockRoomService as any);
    
    gateway.handleJoin({ ticketId: '123' }, { id: 'socket_abc' });
    
    expect(mockRoomService.joinRoom).toHaveBeenCalledWith('socket_abc', 'ticket:123');
  });
});
```

This testability is a key reason why fluo uses a service-based approach to rooms instead of attaching methods to the socket object.

## 14.10 FluoShop support chat flow

With Socket.IO, the FluoShop support system functions at scale:

1. The customer enters the support page, triggering a namespace connection to `/support`.
2. The `auth.connection` guard verifies their session.
3. The customer clicks "Open Ticket", and the gateway joins their socket to `ticket:{id}`.
4. Support agents (in an admin namespace) can see all active tickets.
5. Messages are broadcasted to the specific room, ensuring privacy and performance.
6. On Bun, the entire system runs on a high-efficiency native engine.

This architecture ensures that FluoShop can handle its growing community with professional-grade real-time infrastructure.

## 14.11 Summary

- `@fluojs/socket.io` brings rooms, namespaces, and broadcasting to the fluo gateway system.
- `SocketIoRoomService` provides a high-level API for room management that is injectable and testable.
- Explicit `auth` guards for connections and messages provide granular security.
- `SOCKETIO_SERVER` allows for low-level server access when needed.
- Native Bun support ensures maximum performance on modern runtimes.
- CORS defaults to `false` for production safety, requiring explicit origin configuration.

Socket.IO is the bridge between simple "ping-pong" sockets and real-world multi-user applications.

By integrating it into the fluo decorator system, FluoShop gains the power of v4 features without sacrificing the clean, modular architecture established in previous chapters.
