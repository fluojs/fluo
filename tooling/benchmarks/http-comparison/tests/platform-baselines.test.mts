import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TARGETS } from '../src/targets';
import { histogramPercentile } from '../src/traffic';
import { cpuSeconds } from '../src/resources';
import { nativeFetch } from '../src/shared/native-app';

test('selects real native and Fluo targets for all seven platforms and Nest for both Node engines', () => {
  // Given: the runner consumes this target inventory.
  // When
  const names = TARGETS.map((target) => target.name).sort();
  // Then: a three-target subset cannot represent a complete baseline.
  assert.deepEqual(names, [
    'native-fastify', 'fluo-fastify', 'nestjs-fastify',
    'native-express', 'fluo-express', 'nestjs-express',
    'native-nodejs', 'fluo-nodejs',
    'native-bun', 'fluo-bun',
    'native-deno', 'fluo-deno',
    'native-workers', 'fluo-workers',
    'native-nextjs', 'fluo-nextjs',
  ].sort());
});

test('computes p95 from counted responses rather than substituting p97.5', () => {
  // Given: the last 5% are much slower.
  const histogram = [[1_000, 95], [100_000, 5]] as const;
  // When / Then
  assert.equal(histogramPercentile(histogram, 95), 1);
  assert.equal(histogramPercentile(histogram, 97.5), 100);
});

test('keeps ps cumulative server CPU seconds separate from client CPU', () => {
  // Given / When / Then
  assert.equal(cpuSeconds('01:02.50'), 62.5);
  assert.equal(cpuSeconds('1:01:02.50'), 3662.5);
});

test('equivalent native responses retain the default Fluo security headers without changing the workload', async () => {
  // Given
  const request = () => new Request('http://localhost/tenants/t-001/users?role=admin&page=1&limit=5');
  // When
  const defaultResponse = await nativeFetch('read-search-local', request(), 'default');
  const equivalentResponse = await nativeFetch('read-search-local', request(), 'equivalent');
  // Then
  assert.equal(defaultResponse.headers.get('x-content-type-options'), null);
  assert.equal(equivalentResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(equivalentResponse.headers.get('content-security-policy'), "default-src 'self'");
  assert.equal(equivalentResponse.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(await equivalentResponse.text(), await defaultResponse.text());
});
