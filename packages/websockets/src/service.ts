/**
 * Root export alias for the default Node.js-backed websocket lifecycle service.
 *
 * @remarks
 * Import this alias from `@fluojs/websockets` when you need the shared lifecycle service token without reaching
 * into runtime-specific subpaths.
 */
export { NodeWebSocketGatewayLifecycleService as WebSocketGatewayLifecycleService } from './node/node-service.js';
