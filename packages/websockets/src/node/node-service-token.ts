import type { WebSocketRoomService } from '../types.js';

/**
 * Lifecycle-service token for the default Node.js-backed websocket runtime.
 *
 * @remarks
 * The root `WebSocketGatewayLifecycleService` export is an alias of this token. Runtime modules bind this
 * token to the Node.js lifecycle implementation lazily during provider resolution so root-package imports
 * preserve token identity without eagerly loading Node-only `node:*` or `ws` implementation modules.
 */
export class NodeWebSocketGatewayLifecycleService implements WebSocketRoomService {
  /** @inheritdoc */
  joinRoom(_socketId: string, _room: string): void {
    throw new Error('NodeWebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }

  /** @inheritdoc */
  leaveRoom(_socketId: string, _room: string): void {
    throw new Error('NodeWebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }

  /** @inheritdoc */
  broadcastToRoom(_room: string, _event: string, _data: unknown): void {
    throw new Error('NodeWebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }

  /** @inheritdoc */
  getRooms(_socketId: string): ReadonlySet<string> {
    throw new Error('NodeWebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }
}
