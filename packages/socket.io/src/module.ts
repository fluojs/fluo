import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { SOCKETIO_OPTIONS_INTERNAL } from './options-token.internal.js';
import { SocketIoLifecycleService } from './adapter.js';
import {
  SOCKETIO_ROOM_SERVICE,
  SOCKETIO_SERVER,
} from './tokens.js';
import type { SocketIoModuleOptions } from './types.js';

/**
 * Creates the provider set that wires Socket.IO lifecycle, server access, and room helpers.
 *
 * @param options Socket.IO adapter options that should be shared by the lifecycle service.
 * @returns Providers that register the lifecycle service plus the public Socket.IO tokens.
 *
 * @example
 * ```ts
 * import { createSocketIoProviders } from '@fluojs/socket.io';
 *
 * const providers = createSocketIoProviders({
 *   shutdown: { timeoutMs: 5_000 },
 * });
 * ```
 */
export function createSocketIoProviders(options: SocketIoModuleOptions = {}): Provider[] {
  return [
    {
      provide: SOCKETIO_OPTIONS_INTERNAL,
      useValue: options,
    },
    {
      provide: SocketIoLifecycleService,
      useClass: SocketIoLifecycleService,
    },
    {
      provide: SOCKETIO_SERVER,
      useFactory: (service: unknown) => (service as SocketIoLifecycleService).getServer(),
      inject: [SocketIoLifecycleService],
    },
    {
      provide: SOCKETIO_ROOM_SERVICE,
      useExisting: SocketIoLifecycleService,
    },
  ];
}

/**
 * Root module entry point for registering the Socket.IO gateway adapter.
 */
export class SocketIoModule {
  /**
   * Creates a global module that exposes the raw Socket.IO server and room service tokens.
   *
   * @param options Socket.IO adapter options applied to the lifecycle service for this module instance.
   * @returns A runtime module definition that can be imported into an application module.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { SocketIoModule } from '@fluojs/socket.io';
   *
   * @Module({
   *   imports: [SocketIoModule.forRoot()],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: SocketIoModuleOptions = {}): ModuleType {
    class SocketIoRuntimeModule extends SocketIoModule {}

    return defineModule(SocketIoRuntimeModule, {
      exports: [SOCKETIO_ROOM_SERVICE, SOCKETIO_SERVER],
      global: true,
      providers: createSocketIoProviders(options),
    });
  }
}
