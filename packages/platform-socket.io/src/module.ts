import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { SocketIoLifecycleService } from './adapter.js';
import {
  SOCKETIO_LIFECYCLE_SERVICE,
  SOCKETIO_OPTIONS,
  SOCKETIO_ROOM_SERVICE,
  SOCKETIO_SERVER,
} from './tokens.js';
import type { SocketIoModuleOptions } from './types.js';

export function createSocketIoProviders(options: SocketIoModuleOptions = {}): Provider[] {
  return [
    {
      provide: SOCKETIO_OPTIONS,
      useValue: options,
    },
    {
      provide: SOCKETIO_LIFECYCLE_SERVICE,
      useClass: SocketIoLifecycleService,
    },
    {
      provide: SOCKETIO_SERVER,
      useFactory: (service: unknown) => (service as SocketIoLifecycleService).getServer(),
      inject: [SOCKETIO_LIFECYCLE_SERVICE],
    },
    {
      provide: SOCKETIO_ROOM_SERVICE,
      useExisting: SOCKETIO_LIFECYCLE_SERVICE,
    },
  ];
}

export function createSocketIoModule(options: SocketIoModuleOptions = {}): ModuleType {
  class SocketIoModule {}

  return defineModule(SocketIoModule, {
    exports: [SOCKETIO_ROOM_SERVICE, SOCKETIO_SERVER],
    global: true,
    providers: createSocketIoProviders(options),
  });
}
