import { describe, expect, expectTypeOf, it } from 'vitest';

import type { WebSocketRoomService } from '@fluojs/websockets';

import * as socketIo from './index.js';
import type { SocketIoRoomService } from './types.js';

describe('@fluojs/socket.io public surface', () => {
  it('keeps the root barrel aligned with the documented module and room contract', () => {
    expect(socketIo).toHaveProperty('SocketIoModule');
    expect((socketIo as { SocketIoModule: { forRoot: unknown } }).SocketIoModule).toHaveProperty('forRoot');
    expect(socketIo).toHaveProperty('SocketIoLifecycleService');
    expect(socketIo).toHaveProperty('SOCKETIO_ROOM_SERVICE');
    expect(socketIo).toHaveProperty('SOCKETIO_SERVER');
    expect(socketIo).not.toHaveProperty('createSocketIoProviders');
    expect(socketIo).not.toHaveProperty('SOCKETIO_OPTIONS_INTERNAL');
    expect(Object.keys(socketIo).sort()).toEqual([
      'SOCKETIO_ROOM_SERVICE',
      'SOCKETIO_SERVER',
      'SocketIoLifecycleService',
      'SocketIoModule',
    ]);
  });

  it('keeps Socket.IO room helpers compatible with the shared websocket room contract', () => {
    const roomContractIsSharedContract: WebSocketRoomService = {} as SocketIoRoomService;

    expect(roomContractIsSharedContract).toBeDefined();
    expectTypeOf<SocketIoRoomService['joinRoom']>().parameters.toEqualTypeOf<[
      socketId: string,
      room: string,
      namespacePath?: string,
    ]>();
    expectTypeOf<SocketIoRoomService['leaveRoom']>().parameters.toEqualTypeOf<[
      socketId: string,
      room: string,
      namespacePath?: string,
    ]>();
    expectTypeOf<SocketIoRoomService['broadcastToRoom']>().parameters.toEqualTypeOf<[
      room: string,
      event: string,
      data: unknown,
      namespacePath?: string,
    ]>();
    expectTypeOf<Parameters<SocketIoRoomService['broadcastToRoom']>[0]>().toEqualTypeOf<string>();
  });
});
