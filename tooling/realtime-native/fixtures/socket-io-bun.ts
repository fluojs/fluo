import { Inject } from '@fluojs/core';
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import { BunHttpApplicationAdapter } from '@fluojs/platform-bun';
import { SocketIoModule, SOCKETIO_ROOM_SERVICE } from '@fluojs/socket.io';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import { io } from 'socket.io-client';

function once(target: { once(event: string, listener: (...arguments_: unknown[]) => void): unknown }, event: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Socket.IO ${event}.`)), 5_000);
    target.once(event, (...arguments_) => {
      clearTimeout(timeout);
      resolve(arguments_);
    });
    target.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

type RoomService = {
  broadcastToRoom(room: string, event: string, data: unknown): void;
  joinRoom(socketId: string, room: string): void;
};

@Inject(SOCKETIO_ROOM_SERVICE)
@WebSocketGateway({ path: '/' })
class NativeSocketIoGateway {
  constructor(private readonly rooms: RoomService) {}

  @OnMessage('join-native-room')
  onJoin(payload: unknown, socket: { id: string }): void {
    this.rooms.joinRoom(socket.id, 'native-room');
    this.rooms.broadcastToRoom('native-room', 'native-room-message', payload);
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [SocketIoModule.forRoot({ transports: ['websocket'] })],
  providers: [NativeSocketIoGateway],
});

const adapter = BunHttpApplicationAdapter.create({
  hostname: '127.0.0.1',
  port: 0,
  stopActiveConnections: true,
});
const app = await FluoFactory.create(AppModule, { adapter });

try {
  await app.listen();
  const server = adapter.getServer();
  if (server?.port === undefined) {
    throw new TypeError('Expected the Bun Socket.IO adapter to expose its assigned port.');
  }

  const client = io(`ws://127.0.0.1:${String(server.port)}`, {
    transports: ['websocket'],
  });

  try {
    await once(client, 'connect');
    const roomMessage = once(client, 'native-room-message');
    client.emit('join-native-room', { runtime: 'socket.io-bun' });

    const [payload] = await roomMessage;
    if (JSON.stringify(payload) !== JSON.stringify({ runtime: 'socket.io-bun' })) {
      throw new Error('Bun Socket.IO room broadcast did not reach the native client.');
    }

    const disconnected = once(client, 'disconnect');
    await app.close();
    await disconnected;
  } finally {
    client.close();
  }
} finally {
  await app.close();
}

console.log('realtime-native socket.io bun passed.');
