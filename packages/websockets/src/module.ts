import type { ModuleType } from '@fluojs/runtime';

import { NodeWebSocketModule } from './node.js';
import type { WebSocketModuleOptions } from './types.js';

/**
 * Root module entry point that defaults to the Node.js WebSocket adapter.
 */
export class WebSocketModule {
  /**
   * Creates a module definition backed by the default Node.js WebSocket runtime.
   *
   * @param options WebSocket adapter options shared with the runtime lifecycle service.
   * @returns A runtime module definition that delegates to {@link NodeWebSocketModule.forRoot}.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { WebSocketModule } from '@fluojs/websockets';
   *
   * @Module({
   *   imports: [WebSocketModule.forRoot()],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: WebSocketModuleOptions = {}): ModuleType {
    return NodeWebSocketModule.forRoot(options);
  }
}
