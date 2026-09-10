import {
  NodeHttpApplicationAdapter,
  type NodeHttpAdapterOptions,
} from '@fluojs/platform-nodejs';
import {
  NodeHttpApplicationAdapter as InternalAdapter,
  type NodeHttpAdapterOptions as InternalOptions,
} from '@fluojs/platform-nodejs/internal';

const options: NodeHttpAdapterOptions = {
  compression: true,
  host: '127.0.0.1',
  http: { maxHeaderSize: 16_384 },
  maxBodySize: 1024,
  multipart: { maxFileSize: 128, maxTotalSize: 2048, strategy: 'stream' },
  port: 0,
  rawBody: true,
  retryDelayMs: 0,
  retryLimit: 1,
  shutdownTimeoutMs: 25,
};
const internalOptions: InternalOptions = options;
const adapter: NodeHttpApplicationAdapter = InternalAdapter.create(internalOptions);
const publicAdapter: InternalAdapter = NodeHttpApplicationAdapter.create(options);
const server: ReturnType<NodeHttpApplicationAdapter['getServer']> = adapter.getServer();
class CustomAdapter extends NodeHttpApplicationAdapter {}
const direct: NodeHttpApplicationAdapter = new CustomAdapter(
  0, '127.0.0.1', 0, 1, true, undefined, options.multipart, 1024, true, 25, options.http,
);
const httpsAdapter: NodeHttpApplicationAdapter = NodeHttpApplicationAdapter.create({
  https: { maxHeaderSize: 32_768 },
});

void server;
void publicAdapter;
void direct;
void httpsAdapter;
