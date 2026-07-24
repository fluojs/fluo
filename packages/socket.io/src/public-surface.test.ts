import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocketRoomService } from '@fluojs/websockets';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SocketIoHandshakeRequest as RootSocketIoHandshakeRequest } from './index.js';
import * as socketIo from './index.js';
import type {
  SocketIoConnectionGuardContext,
  SocketIoHandshakeRequest,
  SocketIoMessageGuardContext,
  SocketIoRoomService,
} from './types.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));

describe('@fluojs/socket.io public surface', () => {
  it('requires the patched Socket.IO peer floor', () => {
    const packageManifest = readFileSync(resolve(sourceDir, '../package.json'), 'utf8');

    expect(packageManifest).toContain('"socket.io": "^4.8.3"');
  });

  it('keeps the Bun engine dependency out of the Node module-load path', () => {
    const adapterSource = readFileSync(resolve(sourceDir, 'adapter.ts'), 'utf8');

    expect(adapterSource).not.toMatch(/^import\s+\{[^}]*BunEngineServer[^}]*\}\s+from\s+['"]@socket\.io\/bun-engine['"];$/m);
  });

  it('keeps Node async context loading deferred until gateway invocation', () => {
    const adapterSource = readFileSync(resolve(sourceDir, 'adapter.ts'), 'utf8');

    expect(adapterSource).not.toMatch(/^import\s+\{[^}]*AsyncLocalStorage[^}]*\}\s+from\s+['"]node:async_hooks['"];$/m);
    expect(adapterSource).toContain("import('node:async_hooks')");
    expect(adapterSource).toContain('namespaceContextPromise ??=');
  });

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

  it('keeps the root handshake request type runtime-neutral while accepting Node and Bun request shapes', () => {
    const typesSource = readFileSync(resolve(sourceDir, 'types.ts'), 'utf8');

    expect(typesSource).not.toContain("from 'node:http'");
    expect(typesSource).not.toContain('import(\'node:http\')');
    expectTypeOf<IncomingMessage>().toMatchTypeOf<SocketIoHandshakeRequest>();
    expectTypeOf<Request>().toMatchTypeOf<SocketIoHandshakeRequest>();
    expectTypeOf<RootSocketIoHandshakeRequest>().toEqualTypeOf<SocketIoHandshakeRequest>();
    expectTypeOf<SocketIoConnectionGuardContext['request']>().toEqualTypeOf<SocketIoHandshakeRequest>();
    expectTypeOf<SocketIoMessageGuardContext['request']>().toEqualTypeOf<SocketIoHandshakeRequest>();
  });
});
