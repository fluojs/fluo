import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import * as report from '../src/report';
import * as workloads from '../src/shared/workloads';
import { measureTargets, shoot } from '../src/traffic';

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void, check: (url: string) => Promise<void>) {
  const server = createServer(handler);
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await check(`http://127.0.0.1:${address.port}`);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

const sequence = [
  { path: '/first', method: 'GET' as const, expectedBody: 'first', expectedStatus: 200 },
  { path: '/second', method: 'GET' as const, expectedBody: 'second', expectedStatus: 200 },
];

// Finite request counts, not wall-clock delays, determine completion.
test('rejects a valid body belonging to a different route', { timeout: 10_000 }, async () => {
  // Given: both bodies are valid somewhere, but this server swaps the routes.
  await withServer((req, res) => res.end(req.url === '/first' ? 'second' : 'first'), async (url) => {
    // When / Then: the actual autocannon seam must reject the swapped responses.
    await assert.rejects(shoot({ url, duration: 1, requests: sequence, connections: 1, amount: 10 }, 'swapped'), /mismatches/);
  });
});

test('rejects an unexpected successful status with the correct body', { timeout: 10_000 }, async () => {
  // Given: a wrong 201 response is still 2xx.
  await withServer((_req, res) => { res.statusCode = 201; res.end('first'); }, async (url) => {
    // When / Then
    await assert.rejects(shoot({ url, duration: 1, requests: [sequence[0]], connections: 1, amount: 5 }, 'wrong-status'), /statusMismatches/);
  });
});

test('cycles POST and GET without body or content-type leakage', { timeout: 10_000 }, async () => {
  // Given
  const received: { method: string | undefined; path: string | undefined; body: string; contentType: string | undefined }[] = [];
  const requests = [
    { method: 'POST' as const, path: '/preview', headers: { 'content-type': 'application/json' }, body: '{"action":"move"}', expectedBody: 'preview', expectedStatus: 200 },
    { method: 'GET' as const, path: '/detail', expectedBody: 'detail', expectedStatus: 200 },
  ];
  await withServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', () => {
      received.push({ method: req.method, path: req.url, body, contentType: req.headers['content-type'] });
      res.end(req.url === '/preview' ? 'preview' : 'detail');
    });
  }, async (url) => {
    // When
    const measurement = await shoot({ url, duration: 1, requests, connections: 1, amount: 6 }, 'cycle');
    const cpu = measurement.clientCpu;
    assert.ok(cpu.wallMicros > 0 && cpu.userMicros >= 0 && cpu.systemMicros >= 0);
    assert.equal(cpu.coreEquivalentPercent, (cpu.userMicros + cpu.systemMicros) / cpu.wallMicros * 100);
    // Then: two complete repeated cycles, including GET after POST.
    assert.deepEqual(received.slice(0, 4), [
      { method: 'POST', path: '/preview', body: '{"action":"move"}', contentType: 'application/json' },
      { method: 'GET', path: '/detail', body: '', contentType: undefined },
      { method: 'POST', path: '/preview', body: '{"action":"move"}', contentType: 'application/json' },
      { method: 'GET', path: '/detail', body: '', contentType: undefined },
    ]);
  });
});

test('missing quote input cannot become the benchmark fixture', () => {
  // Given / When: the shared boundary must reject a missing materialized body.
  // Then
  assert.throws(() => workloads.toQuoteInput(undefined));
});

test('warms each target immediately before measuring it', async () => {
  // Given
  const calls: string[] = [];
  // When
  await measureTargets(['nest', 'fluo', 'bun'], {
    warmup: async (target: string) => { calls.push(`warm:${target}`); },
    measure: async (target: string) => { calls.push(`measure:${target}`); return target; },
  });
  // Then
  assert.deepEqual(calls, ['warm:nest', 'measure:nest', 'warm:fluo', 'measure:fluo', 'warm:bun', 'measure:bun']);
});

test('reports median and sample variation without hiding outliers', () => {
  // Given
  // When / Then
  assert.deepEqual(report.summarize([1, 2, 9]), { count: 3, mean: 4, median: 2, min: 1, max: 9, standardDeviation: Math.sqrt(19) });
  assert.deepEqual(report.summarize([7]), { count: 1, mean: 7, median: 7, min: 7, max: 7, standardDeviation: null });
});

test('each concurrent connection starts and repeats the same route cycle', { timeout: 10_000 }, async () => {
  // Given
  const byConnection = new Map<number, string[]>();
  await withServer((req, res) => {
    const port = req.socket.remotePort;
    assert.ok(port);
    const paths = byConnection.get(port) ?? [];
    paths.push(req.url ?? '');
    byConnection.set(port, paths);
    res.end(req.url === '/first' ? 'first' : 'second');
  }, async (url) => {
    // When
    await shoot({ url, duration: 1, requests: sequence, connections: 2, amount: 20 }, 'per-connection cycle');
    // Then
    assert.equal(byConnection.size, 2);
    for (const paths of byConnection.values()) {
      assert.deepEqual(paths.slice(0, 4), ['/first', '/second', '/first', '/second']);
    }
  });
});

test('shared quote normalization uses the received payload, not canned line items', () => {
  // Given
  const payload = { customerId: 'other', coupon: '', shippingRegion: 'east', items: [{ sku: 'other', quantity: 1, unitPriceCents: 100 }] };
  // When
  const quote = workloads.jsonCommandLocal(workloads.toQuoteInput(payload));
  // Then
  assert.equal(quote.customerId, 'other');
  assert.equal(quote.subtotalCents, 100);
  assert.equal(quote.totalCents, 904);
});
