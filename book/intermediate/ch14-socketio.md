<!-- packages: @fluojs/socket.io, @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 14. Advanced Socket.IO

This chapter explains how to add a Socket.IO layer on top of raw WebSocket and connect high level realtime features such as rooms, namespaces, and broadcasting to FluoShop. Chapter 13 established a gateway based realtime surface. Now we expand it into maintainable Socket.IO patterns for multiple user chat and fine grained message control.

## Learning Objectives
- Understand why Socket.IO provides higher level collaboration features than raw WebSocket.
- Learn how to configure CORS and engine limits explicitly with `SocketIoModule.forRoot()`.
- Explain a structure that separates room joins from broadcasts with `SocketIoRoomService`.
- Analyze how namespaces and message Guards refine realtime security boundaries.
- Summarize the extension points provided by raw `Server` access and Bun engine support.
- Explain how to keep multiple room flows such as support chat testable.

## Prerequisites
- Complete Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12, and Chapter 13.
- A basic understanding of the WebSocket gateway lifecycle and realtime message routing.
- A basic sense of multiple user chat requirements such as authentication, room separation, and broadcast.

## 14.1 Why Socket.IO for FluoShop?

While `@fluojs/websockets` from Chapter 13 is a good fit for simple streams such as order updates, some features are hard to implement correctly with only raw sockets.

- **Rooms**: Broadcast messages to every user in "Support Ticket #123".
- **Automatic Reconnection**: Handle unstable mobile networks without losing application state.
- **Namespaces**: Separate "Public Chat" from "Internal Admin Alerts" within a single connection.
- **Broadcasting**: Send a message to everyone *except* the sender.

Socket.IO provides these features as first class concepts. FluoShop uses Socket.IO for its customer support portal, where each support ticket is managed as a room and each department is managed as a namespace. That structure lets user conversations, internal agent flows, and operational alerts stay separated on the same realtime foundation.

## 14.2 Socket.IO module wiring

Registration follows the existing fluo pattern, with Socket.IO specific configuration added. These options gather realtime policies such as CORS, payload limits, and engine behavior at the Module boundary.

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

By default, fluo keeps CORS deny by default, meaning `origin: false`. To allow cross origin browser clients, you must explicitly write the allowed origin list. The `engine` configuration maps directly to Engine.IO, letting you limit payload size for production stability. These defaults are a safer starting point because realtime browser connections often stay open for a long time.

## 14.3 Room management with SocketIoRoomService

One of Socket.IO's core features is room management. When a customer opens a support ticket in FluoShop, the customer must join a room based on that ticket ID. Instead of manipulating the socket object directly, fluo provides `SOCKETIO_ROOM_SERVICE`. This service boundary keeps room membership and broadcast rules from being scattered through gateway code.

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

@Inject(SOCKETIO_ROOM_SERVICE)
@WebSocketGateway({ path: '/support' })
export class SupportChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

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

`SocketIoRoomService` separates room logic from the gateway. With this structure, regular services that cannot access the original socket instance can still broadcast to a specific room. Realtime delivery becomes an explicit collaboration point for application services instead of being trapped inside socket handlers.

## 14.4 Guarding namespaces and messages

Security in realtime systems often needs more detailed control than a simple handshake Guard. You may want to allow connections to the `/support` namespace, but allow "send_message" only when the user is authenticated. `SocketIoModule.forRoot` supports explicit auth Guards, so connection permissions and message permissions can be evaluated at different levels.

```typescript
SocketIoModule.forRoot({
  auth: {
    connection({ socket }) {
      // Namespace level authentication
      const token = socket.handshake.auth.token;
      return token === 'valid' ? true : { message: 'Authentication failed' };
    },
    message({ event, payload }) {
      // Message level authentication
      if (event === 'admin_command' && !payload.isAdmin) {
        return { message: 'Unauthorized command.' };
      }
      return true;
    }
  }
})
```

If these Guards return anything other than `true`, the connection or message is rejected with a standardized Socket.IO error object. Clients can handle failures consistently, and the server can block unauthorized realtime work before a handler runs.

## 14.5 Accessing the raw server

Sometimes you need to go beyond the abstraction and access the underlying Socket.IO `Server` instance directly. This is common when connecting a custom adapter such as a Redis adapter for multiple node scaling, or when listening to low level server events. You can inject the raw server with the `SOCKETIO_SERVER` Token. Keep this access narrow so platform extension points do not spread through ordinary application code.

```typescript
import { Inject } from '@fluojs/core';
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
export class ScalingService {
  constructor(private readonly io: Server) {
    // Perform low level server setup
    console.log('Socket.IO Server instance is available');
  }
}
```

This boundary lets fluo provide a decorator based surface without blocking the extension points of the underlying library. Most code can use fluo's declarative gateways, while operational exceptions stay gathered around the raw server boundary.

## 14.6 Bun engine details

fluo prioritizes support for Bun's high performance WebSocket implementation. Socket.IO usually uses the `ws` package on Node.js, but on Bun it can use `@socket.io/bun-engine`. When FluoShop runs on Bun, the `@fluojs/socket.io` adapter automatically detects the environment and switches to the Bun engine when available. This choice lets FluoShop handle many concurrent support chats with lower memory overhead than a standard Node.js process.

## 14.7 Broadcasting to multiple rooms

In the FluoShop support portal, an agent may need to broadcast a global announcement to every active ticket. Letting the service method accept multiple rooms keeps the caller simpler than manually looping through room names.

```typescript
@OnMessage('global_announcement')
handleAnnouncement(payload: { message: string }) {
  // Broadcast to multiple rooms at once
  this.rooms.broadcastToRoom(['ticket:active', 'staff:updates'], 'announcement', {
    text: payload.message
  });
}
```

The `broadcastToRoom` method accepts both a single string and an array of strings. This matches the underlying Socket.IO behavior, but exposes it through an injectable service interface. Domain services outside the gateway can therefore send messages to multiple conversations through the same pattern.

## 14.8 Handling volatile messages

Sometimes you need to send messages that are useful only *right now*. For example, when a client is temporarily disconnected, you may not want that client to receive the message after reconnecting. This is the opposite of Socket.IO's default buffering behavior. FluoShop examples include "user is typing" indicators or live cursor positions in dashboards. With `SocketIoRoomService`, you can send volatile messages that are discarded if they cannot reach the client.

## 14.9 Testing Socket.IO gateways

fluo gateways are plain classes, so they are easy to test. By mocking `SocketIoRoomService`, you can verify that a gateway joins the correct room and broadcasts the expected event without starting real network sockets. Tests can focus on the room and event contract chosen by the gateway instead of the transport itself.

```typescript
describe('SupportChatGateway', () => {
  it('joins the correct ticket room', () => {
    const mockRoomService = { joinRoom: vi.fn() };
    const gateway = new SupportChatGateway(mockRoomService as any);
    
    gateway.handleJoin({ ticketId: '123' }, { id: 'socket_abc' });
    
    expect(mockRoomService.joinRoom).toHaveBeenCalledWith('socket_abc', 'ticket:123');
  });
});
```

This testability is a core reason fluo treats room management as a service based concern instead of attaching methods to socket objects. With a service boundary in place, most business flows can be checked quickly without a running Socket.IO server.

## 14.10 FluoShop support chat flow

With Socket.IO, the FluoShop support system can handle large scale realtime flows. Rooms, namespaces, and guards work together to separate ticket conversations from internal operational channels.

1. When a customer opens the support page, a connection to the `/support` namespace is triggered.
2. The `auth.connection` Guard verifies the customer's session.
3. When the customer clicks "Open ticket", the gateway joins the customer's socket to the `ticket:{id}` room.
4. Agents, in the admin namespace, can see all active tickets.
5. Messages are broadcast to a specific room, ensuring both privacy and performance.
6. In a Bun environment, the entire system runs on a highly efficient native engine.

This architecture lets FluoShop absorb growing customer support traffic through explicit realtime infrastructure. As the support flow grows, message routing, permissions, and test boundaries remain inside the same pattern.

## 14.11 Summary

- `@fluojs/socket.io` brings room, namespace, and broadcasting features into the fluo gateway system.
- `SocketIoRoomService` provides a high level API for room management that can be injected and tested.
- Explicit `auth` Guards for connections and messages provide fine grained security.
- `SOCKETIO_SERVER` provides low level server access when needed.
- Native Bun support ensures maximum performance on modern runtimes.
- The CORS default is `false` for safety, and explicit origin configuration is required.

Socket.IO is the bridge between simple ping pong sockets and real multiple user applications. By integrating it with the fluo decorator system, FluoShop can use Socket.IO's high level features while preserving the modular architecture built in earlier chapters. Realtime collaboration features are operated through familiar pieces such as Modules, Providers, and Guards.
