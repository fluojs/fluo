/**
 * Complete example from the `@fluojs/websockets` package guide
 * (`apps/docs/content/docs/packages/websockets.mdx`).
 *
 * A chat gateway over `@fluojs/websockets/node`:
 * - `ChatGateway` answers `ping` messages with an explicit `pong` reply frame,
 *   echoes the stable `socketId` for `join`, and injects `ChatAudit` through
 *   normal constructor DI (same-module provider visibility).
 * - `PresenceService` wraps the room contract. The Node runtime module binds
 *   `NodeWebSocketGatewayLifecycleService` for its own upgrade/dispatch work
 *   and does not export the token, so application code resolves it from the
 *   application container and hands it to this service (see the guide's
 *   "Rooms and broadcast" section for the visibility boundary).
 *
 * The module registers the gateway and its collaborators as providers and
 * imports `NodeWebSocketModule.forRoot()` for the runtime wiring. The HTTP
 * listener, upgrade handling, limits, heartbeat, and shutdown behavior come
 * from the adapter plus `NodeWebSocketModule` defaults.
 */
import { Inject, Module } from '@fluojs/core';
import {
  OnConnect,
  OnDisconnect,
  OnMessage,
  WebSocketGateway,
  type WebSocketRoomService,
} from '@fluojs/websockets';
import { NodeWebSocketModule } from '@fluojs/websockets/node';

/** Minimal structural view of the runtime socket a reply needs. */
export interface ChatSocket {
  send(data: string): void;
}

export class ChatAudit {
  readonly joins: string[] = [];
}

@Inject(ChatAudit)
@WebSocketGateway({ path: '/chat' })
export class ChatGateway {
  constructor(private readonly audit: ChatAudit) {}

  @OnConnect()
  handleConnect(): void {
    // Connection bookkeeping can start here; the socket is registered and
    // receive loops are already bound when connect handlers run.
  }

  @OnMessage('join')
  handleJoin(
    _payload: unknown,
    socket: ChatSocket,
    _request: unknown,
    socketId: string,
  ): void {
    this.audit.joins.push(socketId);
    socket.send(JSON.stringify({ event: 'joined', data: { socketId } }));
  }

  @OnMessage('ping')
  handlePing(payload: unknown, socket: ChatSocket): void {
    socket.send(JSON.stringify({ event: 'pong', data: payload }));
  }

  @OnDisconnect()
  handleDisconnect(): void {
    // Room membership and registry cleanup are handled by the runtime.
  }
}

/**
 * Application-side room operations. Constructed with the container-resolved
 * lifecycle service, typed against the shared `WebSocketRoomService` contract.
 */
export class PresenceService {
  constructor(private readonly rooms: WebSocketRoomService) {}

  joinLobby(socketId: string): void {
    this.rooms.joinRoom(socketId, 'chat:lobby');
  }

  broadcastToLobby(event: string, data: unknown): void {
    this.rooms.broadcastToRoom('chat:lobby', event, data);
  }

  lobbyMemberships(socketId: string): ReadonlySet<string> {
    return this.rooms.getRooms(socketId);
  }
}

@Module({
  imports: [NodeWebSocketModule.forRoot()],
  providers: [ChatAudit, ChatGateway],
})
export class AppModule {}
