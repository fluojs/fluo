/**
 * Complete example from the `@fluojs/socket.io` package guide
 * (`apps/docs/content/docs/packages/socket-io.mdx`).
 *
 * A Socket.IO chat namespace over the shared `@WebSocketGateway` authoring API:
 * - `ChatGateway` is bound to the `/chat` Socket.IO namespace (gateway `path`
 *   maps to the namespace, not the Engine.IO request path, which stays
 *   `/socket.io/`). `chat:join` joins the socket to a room and completes
 *   through the acknowledgement callback.
 * - `AnnouncementService` injects the raw `SOCKETIO_SERVER` token for
 *   Socket.IO-native emits that the shared room contract does not wrap.
 *
 * `SocketIoModule.forRoot()` exports `SOCKETIO_ROOM_SERVICE` and
 * `SOCKETIO_SERVER` globally by default, so providers in any module can inject
 * them. Handler arguments follow the shared positional model
 * `(payload, socket, request, acknowledgement)`; connect handlers receive
 * `(socket, request)`.
 */
import { Inject, Module } from '@fluojs/core';
import { SocketIoModule, SOCKETIO_ROOM_SERVICE, SOCKETIO_SERVER, type SocketIoRoomService } from '@fluojs/socket.io';
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';

/** Structural view of the Socket.IO socket a handler needs (full `Socket` type ships with the `socket.io` peer). */
export interface ChatSocket {
  readonly id: string;
}

/** Structural view of the Socket.IO server surface used by this example. */
export interface SocketIoServerLike {
  of(namespace: string): {
    to(room: string): {
      emit(event: string, data: unknown): void;
    };
  };
}

@Inject(SOCKETIO_ROOM_SERVICE)
@WebSocketGateway({ path: '/chat' })
export class ChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

  @OnMessage('chat:join')
  handleJoin(
    payload: { room?: string },
    socket: ChatSocket,
    _request: unknown,
    ack?: (response: unknown) => void,
  ): void {
    const room = payload.room ?? 'chat:lobby';

    this.rooms.joinRoom(socket.id, room);
    ack?.({ joined: room });
  }
}

@Inject(SOCKETIO_SERVER)
export class AnnouncementService {
  constructor(private readonly io: SocketIoServerLike) {}

  broadcastToLobby(event: string, data: unknown): void {
    this.io.of('/chat').to('chat:lobby').emit(event, data);
  }
}

@Module({
  imports: [SocketIoModule.forRoot()],
  providers: [AnnouncementService, ChatGateway],
})
export class AppModule {}
