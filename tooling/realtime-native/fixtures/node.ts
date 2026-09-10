import { OnConnect, OnMessage, WebSocketGateway } from '@fluojs/websockets';
import {
  NodeWebSocketGatewayLifecycleService,
  NodeWebSocketModule,
} from '@fluojs/websockets/node';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory, defineModule } from '@fluojs/runtime';

function once(socket: WebSocket, event: 'close' | 'message' | 'open'): Promise<Event | void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Node ${event}.`)), 5_000);
    socket.addEventListener(event, (value) => {
      clearTimeout(timeout);
      resolve(event === 'message' ? value : undefined);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`Node websocket failed before ${event}.`));
    }, { once: true });
  });
}

function messageData(event: Event | void): string {
  if (!(event instanceof MessageEvent)) {
    throw new TypeError('Expected a Node websocket message event.');
  }

  return String(event.data);
}

function portOf(server: unknown): number {
  if (typeof server !== 'object' || server === null || !('address' in server) || typeof server.address !== 'function') {
    throw new TypeError('Expected a Node server with address().');
  }

  const address = server.address();
  if (typeof address !== 'object' || address === null || !('port' in address) || typeof address.port !== 'number') {
    throw new TypeError('Expected a bound Node server address.');
  }

  return address.port;
}

@WebSocketGateway({ path: '/native-node' })
class NativeNodeGateway {
  @OnConnect()
  onConnect(): void {}

  @OnMessage('identify')
  onIdentify(_payload: unknown, socket: { send(data: string): void }, _request: unknown, socketId: string): void {
    socket.send(JSON.stringify({ data: { socketId }, event: 'identified' }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [NodeWebSocketModule.forRoot()],
  providers: [NativeNodeGateway],
});

const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
const app = await FluoFactory.create(AppModule, { adapter });
const rooms = await app.container.resolve(NodeWebSocketGatewayLifecycleService);

try {
  await app.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${String(portOf(adapter.getServer?.()))}/native-node`);
  await once(socket, 'open');

  const identified = once(socket, 'message');
  socket.send(JSON.stringify({ data: null, event: 'identify' }));
  const parsed = JSON.parse(messageData(await identified));
  const socketId = parsed?.data?.socketId;

  if (typeof socketId !== 'string') {
    throw new TypeError('Node gateway did not expose a socket identity.');
  }

  rooms.joinRoom(socketId, 'native-room');
  const roomMessage = once(socket, 'message');
  rooms.broadcastToRoom('native-room', 'room.echo', { runtime: 'node' });

  if (messageData(await roomMessage) !== JSON.stringify({ data: { runtime: 'node' }, event: 'room.echo' })) {
    throw new Error('Node room broadcast did not reach the native websocket.');
  }

  const closed = once(socket, 'close');
  await app.close();
  await closed;
} finally {
  await app.close();
}

console.log('realtime-native node raw websocket passed.');
