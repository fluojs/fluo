import { once } from 'node:events';
import { createServer } from 'node:http';
import { EvidenceJournal } from '../../src/evidence';
import '../../src/targets';
import { shoot } from '../../src/traffic';

const completed: unknown[] = [];
const journal = new EvidenceJournal(process.argv[2], () => ({ schemaVersion: 3, completed, baselineStatus: 'inconclusive' }));
const server = createServer((request, response) => {
  response.statusCode = request.url === '/ok' ? 200 : 503;
  response.end('body');
});
const ready = once(server, 'listening');
server.listen(0, '127.0.0.1');
await ready;
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing fixture address');
const options = {
  url: `http://127.0.0.1:${address.port}`, duration: 1, amount: 1, connections: 1,
  requests: [{ path: '/ok', method: 'GET' as const, expectedBody: 'body', expectedStatus: 200 }],
};
try {
  await journal.record({ target: 'good', phase: 'measurement' }, completed, async (complete) => {
    complete(await shoot(options, 'good'));
    if (process.argv[3] === 'signal-after-complete') {
      process.stdout.write('READY\n');
      await new Promise(() => {});
    }
  });
  journal.current = { target: 'bad', phase: 'measurement' };
  if (process.argv[3] === 'signal') {
    process.stdout.write('READY\n');
    await new Promise(() => {});
  }
  await journal.record({ target: 'bad', phase: 'measurement' }, completed,
    async (complete) => complete(await shoot({ ...options, requests: [{ ...options.requests[0], path: '/bad' }] }, 'bad')));
} catch (error) {
  if (!(error instanceof Error)) throw error;
  process.exitCode = 1;
} finally {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
  journal.finish();
}
