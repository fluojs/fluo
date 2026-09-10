/// <reference lib="es2024.promise" />

declare const Deno: { readTextFile(path: URL): Promise<string> };

const loadBuiltPackage = async (name: string, entrypoint = '.') => {
  const manifestUrl = new URL(`../../../packages/${name}/package.json`, import.meta.url);
  const manifest = JSON.parse(await Deno.readTextFile(manifestUrl));

  return await import(new URL(manifest.exports[entrypoint].import, manifestUrl).href);
};

const [
  websockets,
  denoWebsockets,
  platform,
  runtime,
] = await Promise.all([
  loadBuiltPackage('websockets'),
  loadBuiltPackage('websockets', './deno'),
  loadBuiltPackage('platform-deno'),
  loadBuiltPackage('runtime'),
]);

const { OnMessage, WebSocketGateway } = websockets;
const {
  DenoWebSocketGatewayLifecycleService,
  DenoWebSocketModule,
} = denoWebsockets;
const { DenoHttpApplicationAdapter } = platform;
const { FluoFactory, defineModule } = runtime;

function once(socket: WebSocket, event: 'close' | 'message' | 'open'): Promise<Event | void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Deno ${event}.`)), 5_000);
    socket.addEventListener(event, (value) => {
      clearTimeout(timeout);
      resolve(event === 'message' ? value : undefined);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`Deno websocket failed before ${event}.`));
    }, { once: true });
  });
}

function messageData(event: Event | void): string {
  if (!(event instanceof MessageEvent)) {
    throw new TypeError('Expected a Deno websocket message event.');
  }

  return String(event.data);
}

@WebSocketGateway({ path: '/native-deno' })
class NativeDenoGateway {
  @OnMessage('identify')
  onIdentify(_payload: unknown, socket: { send(data: string): void }, _request: Request, socketId: string): void {
    socket.send(JSON.stringify({ data: { socketId }, event: 'identified' }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [DenoWebSocketModule.forRoot()],
  providers: [NativeDenoGateway],
});

const listening = Promise.withResolvers<{ hostname: string; port: number }>();
const adapter = DenoHttpApplicationAdapter.create({
  hostname: '127.0.0.1',
  onListen: listening.resolve,
  port: 0,
});
const app = await FluoFactory.create(AppModule, { adapter });
const rooms = await app.container.resolve(DenoWebSocketGatewayLifecycleService);

try {
  await app.listen();
  const address = await listening.promise;
  const socket = new WebSocket(`ws://${address.hostname}:${String(address.port)}/native-deno`);
  await once(socket, 'open');

  const identified = once(socket, 'message');
  socket.send(JSON.stringify({ data: null, event: 'identify' }));
  const parsed = JSON.parse(messageData(await identified));
  const socketId = parsed?.data?.socketId;

  if (typeof socketId !== 'string') {
    throw new TypeError('Deno gateway did not expose a socket identity.');
  }

  rooms.joinRoom(socketId, 'native-room');
  const roomMessage = once(socket, 'message');
  rooms.broadcastToRoom('native-room', 'room.echo', { runtime: 'deno' });

  if (messageData(await roomMessage) !== JSON.stringify({ data: { runtime: 'deno' }, event: 'room.echo' })) {
    throw new Error('Deno room broadcast did not reach the native websocket.');
  }

  const closed = once(socket, 'close');
  await app.close();
  await closed;
} finally {
  await app.close();
}

console.log('realtime-native deno raw websocket passed.');
