import type { WebSocketRoomService } from './types.js';

/**
 * Root lifecycle-service token for the default Node.js-backed websocket runtime.
 *
 * @remarks
 * `WebSocketModule.forRoot()` binds this token to the Node.js lifecycle implementation lazily during runtime
 * provider resolution. Importing the root package therefore preserves the public token name without eagerly
 * loading Node-only `node:*` or `ws` implementation modules.
 */
export class WebSocketGatewayLifecycleService implements WebSocketRoomService {
  /** @inheritdoc */
  joinRoom(): void {
    throw new Error('WebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }

  /** @inheritdoc */
  leaveRoom(): void {
    throw new Error('WebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }

  /** @inheritdoc */
  broadcastToRoom(): void {
    throw new Error('WebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }

  /** @inheritdoc */
  getRooms(): ReadonlySet<string> {
    throw new Error('WebSocketGatewayLifecycleService is a runtime provider token and must be resolved from DI.');
  }
}
