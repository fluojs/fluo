import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { shoot, TrafficFailure, type ScenarioRequest } from '../src/traffic';

const require = createRequire(import.meta.url);
const autocannonRequire = createRequire(require.resolve('autocannon'));
const Parser: unknown = autocannonRequire('http-parser-js').HTTPParser;
assert.ok(typeof Parser === 'function');
const parserConstructor = Parser;
async function fragmentedShoot(
  requests: readonly ScenarioRequest[],
  replies: readonly { readonly path: string; readonly bytes: Buffer; readonly status: number }[],
  amount: number,
) {
  const prototype: unknown = Reflect.get(parserConstructor, 'prototype');
  assert.ok(typeof prototype === 'object' && prototype !== null);
  const execute: unknown = Reflect.get(prototype, 'execute');
  assert.ok(typeof execute === 'function');
  const fragments = new EventEmitter();
  const seen: number[] = [];
  const received = once(fragments, 'first-fragment', { signal: AbortSignal.timeout(5_000) });
  const server = createServer((request, response) => {
    const reply = replies.find((entry) => entry.path === request.url);
    assert.ok(reply);
    response.writeHead(reply.status, { 'content-length': reply.bytes.length });
    response.end(reply.bytes);
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  // Use the installed parser and real HTTP bytes. Splitting execute input makes
  // kOnBody boundaries deterministic even when the OS coalesces TCP writes.
  Reflect.set(prototype, 'execute', function (this: unknown, bytes: Buffer) {
    for (let offset = 0; offset < bytes.length; offset += 1) {
      const fragment = bytes.subarray(offset, offset + 1);
      const result: unknown = Reflect.apply(execute, this, [fragment]);
      if (result instanceof Error) return result;
      seen.push(fragment[0]);
      fragments.emit('first-fragment');
    }
    return bytes.length;
  });
  try {
    const measurement = shoot({ url: `http://127.0.0.1:${address.port}`, duration: 1, connections: 1, amount, requests }, 'fragment-correctness-only');
    const [result] = await Promise.all([measurement, received]);
    return { result, seen };
  } finally {
    Reflect.set(prototype, 'execute', execute);
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

test('shoot: received UTF8 code point split into c3 and a9 -> preserves exact response', { timeout: 10_000 }, async () => {
  const requests = [{ path: '/utf8', method: 'GET', expectedBody: '\u00e9', expectedStatus: 200 }] as const;
  const replies = [{ path: '/utf8', bytes: Buffer.from([0xc3, 0xa9]), status: 200 }];

  const { result, seen } = await fragmentedShoot(requests, replies, 1);

  assert.equal(result.result.requests.total, 1);
  assert.equal(result.result.mismatches, 0);
  assert.equal(result.statusMismatches, 0);
  assert.ok(seen.includes(0xc3) && seen.includes(0xa9));
});

test('shoot: fragmented wrong received body -> retains body mismatch failure', { timeout: 10_000 }, async () => {
  const requests = [{ path: '/utf8', method: 'GET', expectedBody: '\u00e9', expectedStatus: 200 }] as const;
  const replies = [{ path: '/utf8', bytes: Buffer.from('\u00e9x'), status: 200 }];

  const action = fragmentedShoot(requests, replies, 1);

  await assert.rejects(action, (error: unknown) => error instanceof TrafficFailure
    && Number(error.diagnostics.result?.mismatches) > 0);
});

test('shoot: correct fragmented body with wrong status -> retains status mismatch failure', { timeout: 10_000 }, async () => {
  const requests = [{ path: '/utf8', method: 'GET', expectedBody: '\u00e9', expectedStatus: 201 }] as const;
  const replies = [{ path: '/utf8', bytes: Buffer.from('\u00e9'), status: 200 }];

  const action = fragmentedShoot(requests, replies, 1);

  await assert.rejects(action, (error: unknown) => error instanceof TrafficFailure
    && error.diagnostics.statusMismatches === 1);
});

test('shoot: repeated UTF8 ASCII and binary responses -> preserves request identity without body leakage', { timeout: 10_000 }, async () => {
  const replies = [
    { path: '/utf8', bytes: Buffer.from('\u00e9'), status: 200 },
    { path: '/ascii', bytes: Buffer.from('ASCII'), status: 201 },
    { path: '/binary', bytes: Buffer.from([0, 127, 128, 255]), status: 200 },
  ];
  const requests: ScenarioRequest[] = replies.map((reply) => ({
    path: reply.path, method: 'GET', expectedBody: reply.bytes.toString('utf8'), expectedStatus: reply.status,
  }));

  const { result } = await fragmentedShoot(requests, replies, 6);

  assert.equal(result.result.requests.total, 6);
  assert.equal(result.result.mismatches, 0);
  assert.equal(result.statusMismatches, 0);
});

test('shoot: body from another queued route -> rejects instead of using expected bytes', { timeout: 10_000 }, async () => {
  const requests = [
    { path: '/one', method: 'GET', expectedBody: '\u00e9', expectedStatus: 200 },
    { path: '/two', method: 'GET', expectedBody: 'ASCII', expectedStatus: 200 },
  ] as const;
  const replies = [
    { path: '/one', bytes: Buffer.from('ASCII'), status: 200 },
    { path: '/two', bytes: Buffer.from('\u00e9'), status: 200 },
  ];

  const action = fragmentedShoot(requests, replies, 2);

  await assert.rejects(action, (error: unknown) => error instanceof TrafficFailure
    && Number(error.diagnostics.result?.mismatches) > 0);
});
