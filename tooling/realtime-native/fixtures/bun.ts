import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import {
  BunWebSocketGatewayLifecycleService,
  BunWebSocketModule,
} from '@fluojs/websockets/bun';
import { BunHttpApplicationAdapter } from '@fluojs/platform-bun';
import { FluoFactory, defineModule } from '@fluojs/runtime';

function once(socket: WebSocket, event: 'close' | 'message' | 'open'): Promise<MessageEvent | void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Bun ${event}.`)), 5_000);
    socket.addEventListener(event, (value) => {
      clearTimeout(timeout);
      resolve(event === 'message' ? value : undefined);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`Bun websocket failed before ${event}.`));
    }, { once: true });
  });
}

function messageData(event: MessageEvent | void): string {
  if (!(event instanceof MessageEvent)) {
    throw new TypeError('Expected a Bun websocket message event.');
  }

  return String(event.data);
}

@WebSocketGateway({ path: '/native-bun' })
class NativeBunGateway {
  @OnMessage('identify')
  onIdentify(_payload: unknown, socket: { send(data: string): void }, _request: Request, socketId: string): void {
    socket.send(JSON.stringify({ data: { socketId }, event: 'identified' }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [BunWebSocketModule.forRoot()],
  providers: [NativeBunGateway],
});

const adapter = BunHttpApplicationAdapter.create({
  hostname: '127.0.0.1',
  port: 0,
  stopActiveConnections: true,
});
const app = await FluoFactory.create(AppModule, { adapter });
const rooms = await app.container.resolve(BunWebSocketGatewayLifecycleService);

try {
  await app.listen();
  const server = adapter.getServer();
  if (server?.port === undefined) {
    throw new TypeError('Expected the Bun adapter to expose its assigned port.');
  }

  const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/native-bun`);
  await once(socket, 'open');

  const identified = once(socket, 'message');
  socket.send(JSON.stringify({ data: null, event: 'identify' }));
  const parsed = JSON.parse(messageData(await identified));
  const socketId = parsed?.data?.socketId;

  if (typeof socketId !== 'string') {
    throw new TypeError('Bun gateway did not expose a socket identity.');
  }

  rooms.joinRoom(socketId, 'native-room');
  const roomMessage = once(socket, 'message');
  rooms.broadcastToRoom('native-room', 'room.echo', { runtime: 'bun' });

  if (messageData(await roomMessage) !== JSON.stringify({ data: { runtime: 'bun' }, event: 'room.echo' })) {
    throw new Error('Bun room broadcast did not reach the native websocket.');
  }

  const closed = once(socket, 'close');
  await app.close();
  await closed;
} finally {
  await app.close();
}

console.log('realtime-native bun raw websocket passed.');
