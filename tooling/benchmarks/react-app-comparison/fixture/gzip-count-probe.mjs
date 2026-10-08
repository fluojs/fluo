import { syncBuiltinESMExports } from 'node:module';
import { Server } from 'node:net';
import { mock } from 'node:test';
import zlib from 'node:zlib';

const gzip = zlib.gzipSync;
const observedGzip = mock.method(zlib, 'gzipSync', (...args) => gzip(...args));
syncBuiltinESMExports();

const listen = Server.prototype.listen;
mock.method(Server.prototype, 'listen', function (...args) {
  this.once('listening', () => {
    process.send({ kind: 'listening', address: this.address() });
  });
  return Reflect.apply(listen, this, args);
});

process.on('message', (message) => {
  if (message.kind === 'gzip-count') {
    process.send({ kind: 'gzip-count', count: observedGzip.mock.callCount() });
  }
});
