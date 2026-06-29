import type { Container } from '@fluojs/di';
import type { HttpApplicationAdapter } from '@fluojs/http';
import type { ApplicationLogger, CompiledModule, ModuleType } from '@fluojs/runtime';
import { defineModule } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import type { WebSocketModuleOptions } from './node/node-types.js';
import { WEBSOCKET_OPTIONS_INTERNAL } from './options-token.internal.js';
import { WebSocketGatewayLifecycleService } from './service.js';

/**
 * Root module entry point that defaults to the Node.js WebSocket adapter.
 */
export class WebSocketModule {
  /**
   * Creates a module definition backed by the default Node.js WebSocket runtime.
   *
   * @param options WebSocket adapter options shared with the runtime lifecycle service.
   * @returns A runtime module definition that lazily binds the Node.js lifecycle implementation.
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
    class WebSocketRuntimeModule extends WebSocketModule {}

    return defineModule(WebSocketRuntimeModule, {
      providers: [
        {
          provide: WEBSOCKET_OPTIONS_INTERNAL,
          useValue: options,
        },
        {
          inject: [RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER, WEBSOCKET_OPTIONS_INTERNAL],
          provide: WebSocketGatewayLifecycleService,
          useFactory: async (...deps: unknown[]) => {
            const [runtimeContainer, compiledModules, logger, adapter, moduleOptions] = deps as [
              Container,
              readonly CompiledModule[],
              ApplicationLogger,
              HttpApplicationAdapter,
              WebSocketModuleOptions,
            ];
            const { NodeWebSocketGatewayLifecycleServiceImplementation } = await import('./node/node-service.js');

            return new NodeWebSocketGatewayLifecycleServiceImplementation(
              runtimeContainer,
              compiledModules,
              logger,
              adapter,
              moduleOptions,
            );
          },
        },
      ],
    });
  }
}
