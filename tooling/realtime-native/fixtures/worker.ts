import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import {
  CloudflareWorkersWebSocketGatewayLifecycleService,
  CloudflareWorkersWebSocketModule,
} from '@fluojs/websockets/cloudflare-workers';
import { CloudflareWorkerHttpApplicationAdapter } from '@fluojs/platform-cloudflare-workers';
import { FluoFactory, defineModule } from '@fluojs/runtime';

@WebSocketGateway({ path: '/native-worker' })
class NativeWorkerGateway {
  @OnMessage('identify')
  onIdentify(_payload: unknown, _socket: { send(data: string): void }, _request: Request, socketId: string): void {
    rooms.joinRoom(socketId, 'native-room');
    rooms.broadcastToRoom('native-room', 'room.echo', { runtime: 'workers', socketId });
  }

  @OnMessage('shutdown')
  onShutdown(): void {
    const closing = app.close();
    executionContext?.waitUntil(closing);
    void closing.then(
      () => console.log('NATIVE_WORKER_CLOSED'),
      (error: unknown) => console.error('NATIVE_WORKER_CLOSE_FAILED', error),
    );
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [CloudflareWorkersWebSocketModule.forRoot()],
  providers: [NativeWorkerGateway],
});

const adapter = CloudflareWorkerHttpApplicationAdapter.create();
const app = await FluoFactory.create(AppModule, { adapter });
const rooms = await app.container.resolve(CloudflareWorkersWebSocketGatewayLifecycleService);
await app.listen();
let executionContext: { waitUntil(promise: Promise<unknown>): void } | undefined;

export default {
  async fetch(request: Request, environment: unknown, context: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    executionContext = context;
    return adapter.fetch(request, environment, context);
  },
};
