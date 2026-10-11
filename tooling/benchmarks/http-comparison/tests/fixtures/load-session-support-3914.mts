import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceJournal } from '../../src/evidence';
import type { TargetResult } from '../../src/report';
import type { TargetConfig } from '../../src/targets';
import type { TrafficOptions } from '../../src/traffic';

export function options(url: string, path = '/'): TrafficOptions {
  return { url, duration: 1, connections: 1, amount: 1,
    requests: [{ path, method: 'GET', expectedBody: 'ok', expectedStatus: 200 }] };
}

export function stopped(pid: number): void {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

export async function httpFixture(defect: 'status' | 'body') {
  const server = createServer((request, response) => {
    if (request.url === '/ok') response.end('ok');
    else {
      response.statusCode = defect === 'status' ? 201 : 200;
      response.end(defect === 'body' ? 'wrong' : 'ok');
    }
  });
  const listening = once(server, 'listening', { signal: AbortSignal.timeout(5_000) });
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      const closed = once(server, 'close', { signal: AbortSignal.timeout(5_000) });
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

export async function scenarioFixture(directory: string, suffix: string) {
  const reservation = createServer();
  const listening = once(reservation, 'listening', { signal: AbortSignal.timeout(5_000) });
  reservation.listen(0, '127.0.0.1');
  await listening;
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const closed = once(reservation, 'close', { signal: AbortSignal.timeout(5_000) });
  reservation.close();
  await closed;
  const target: TargetConfig = {
    name: 'native-nodejs', platform: 'nodejs', product: 'native', label: 'native-nodejs',
    port: address.port, command: process.execPath,
    args: [fileURLToPath(new URL('./timing-server.mjs', import.meta.url))],
  };
  const samples: TargetResult[] = [];
  const path = join(directory, `session-${suffix}.json`);
  const journal = new EvidenceJournal(path, () => ({ samples }));
  return {
    target, samples, path, journal,
    scenario: {
      name: 'finite-load-session', description: 'correctness only', appShape: 'read-search-local' as const,
      requests: [{ path: '/', method: 'GET' as const, expectedStatus: 200, expectedBody: '{"ok":true}' }],
    },
  };
}
