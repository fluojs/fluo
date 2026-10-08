import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer, Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { readAppShape } from '../src/shared/app-shape';
import { resolveAppModule } from '../src/shared/fluo-app';
import { createNativeStage } from '../src/shared/native-stages';
import { resolveNestStageModule } from '../src/shared/nest-stages';
import { StageService, type StageShape } from '../src/shared/stage-workloads';
import { SCENARIOS, STAGE_SCENARIOS } from '../src/scenarios';
import { buildTarget, startTargets, stopTargets, TARGETS, waitForTarget } from '../src/targets';

type Product = 'native' | 'fluo' | 'nestjs-fastify' | 'nestjs-express';

function portOf(server: unknown) {
  assert.ok(server instanceof Server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function withStage(product: Product, shape: StageShape, run: (base: string) => Promise<void>) {
  let close: () => Promise<unknown>;
  let server: unknown;
  switch (product) {
    case 'native': {
      const stage = createNativeStage(shape);
      const host = createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += String(chunk);
        const result = stage(request.method ?? '', new URL(request.url ?? '/', 'http://localhost'), body ? JSON.parse(body) : undefined);
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(result.body);
      });
      const ready = once(host, 'listening');
      host.listen(0, '127.0.0.1');
      await ready;
      server = host;
      close = async () => {
        const closed = once(host, 'close');
        host.close();
        host.closeAllConnections();
        await closed;
      };
      break;
    }
    case 'fluo': {
      const adapter = NodeHttpApplicationAdapter.create({ port: 0, host: '127.0.0.1' });
      const app = await FluoFactory.create(resolveAppModule(shape), { adapter });
      await app.listen();
      server = adapter.getServer();
      close = () => app.close();
      break;
    }
    case 'nestjs-fastify':
    case 'nestjs-express': {
      const adapter = product === 'nestjs-fastify' ? new FastifyAdapter() : new ExpressAdapter();
      const app = await NestFactory.create(resolveNestStageModule(shape), adapter, { logger: false });
      await app.listen(0, '127.0.0.1');
      server = app.getHttpServer();
      close = () => app.close();
      break;
    }
  }
  try { await run(`http://127.0.0.1:${portOf(server)}`); }
  finally { await close(); }
}

async function send(base: string, path: string, body?: string) {
  return fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function assertScenarios(base: string, scenarios = STAGE_SCENARIOS) {
  for (const scenario of scenarios) {
    for (const request of scenario.requests) {
      const response = await send(base, request.path, request.body);
      assert.equal(response.status, request.expectedStatus, scenario.name);
      assert.equal(await response.text(), request.expectedBody, scenario.name);
    }
  }
}

test('accepts explicit stage shapes without changing the business default', () => {
  // Given / When / Then: an explicit floor fixture is selectable.
  assert.equal(readAppShape(), 'read-search-local');
  assert.doesNotThrow(() => readAppShape('stage-minimal'));
  for (const scenario of STAGE_SCENARIOS) assert.equal(readAppShape(scenario.appShape), scenario.appShape);
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.name), ['read-search-local', 'json-command-local', 'rest-route-mix-local']);
  assert.throws(() => readAppShape('stage-unknown'), /Unsupported BENCH_APP_SHAPE/);
});

for (const product of ['native', 'fluo', 'nestjs-fastify', 'nestjs-express'] as const) {
  test(`${product} serves every independent stage over real HTTP`, { timeout: 60_000 }, async () => {
    // Given / When: each fixture starts its own graph and real HTTP host.
    for (const scenario of STAGE_SCENARIOS) {
      assert.ok(scenario.appShape.startsWith('stage-'));
      const shape = readAppShape(scenario.appShape);
      if (shape === 'read-search-local' || shape === 'json-command-local' || shape === 'rest-route-mix-local') throw new Error('Expected a stage');
      // Then: wire bytes have the request-specific shape and status.
      await withStage(product, shape, (base) => assertScenarios(base, [scenario]));
    }
  });

  test(`${product} routing responds to changed path and query`, async () => {
    // Given / When
    await withStage(product, 'stage-routing-params', async (base) => {
      const response = await send(base, '/stage/items/other-item?value=beta');
      // Then
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { itemId: 'other-item', value: 'beta' });
      assert.equal((await send(base, '/wrong/items/other?value=beta')).status, 404);
    });
  });

  test(`${product} materializes the actual changed body without a fallback`, async () => {
    // Given / When
    await withStage(product, 'stage-body', async (base) => {
      const changed = await send(base, '/stage', '{"name":"beta","quantity":7}');
      const missing = await send(base, '/stage', '{}');
      // Then
      assert.equal(changed.status, 201);
      assert.deepEqual(await changed.json(), { name: 'beta', quantity: 7 });
      assert.notDeepEqual(await missing.json(), { name: 'alpha', quantity: 3 });
    });
  });

  test(`${product} rejects guard denial outside the success scenario`, async () => {
    // Given / When
    await withStage(product, 'stage-guards', async (base) => {
      const denied = await send(base, '/stage?token=deny&value=beta');
      // Then
      assert.equal(denied.status, 403);
    });
  });

  test(`${product} binds changed DTO input and rejects malformed fields`, async () => {
    // Given / When
    await withStage(product, 'stage-dto-validation', async (base) => {
      const changed = await send(base, '/stage', '{"name":"beta","quantity":7}');
      // Then: binding returns a real DTO, not the original unvalidated object.
      assert.deepEqual(await changed.json(), { name: 'beta', quantity: 7, bound: true });
      for (const body of ['{}', 'null', '{"name":"","quantity":3}', '{"name":"beta","quantity":0}', '{"name":"beta","quantity":"7"}', '{"name":"beta","quantity":7,"extra":"rejected"}']) {
        assert.equal((await send(base, '/stage', body)).status, 400, body);
      }
    });
  });

  test(`${product} encodes a generated nested response for changed input`, async () => {
    // Given / When
    await withStage(product, 'stage-serialization', async (base) => {
      const response = await send(base, '/stage?value=beta');
      // Then
      assert.deepEqual(await response.json(), {
        value: 'beta',
        items: Array.from({ length: 16 }, (_, index) => ({ index, label: `beta:${index}`, enabled: index % 2 === 0 })),
      });
    });
  });

  test(`${product} reuses a singleton within and across requests`, async () => {
    // Given / When
    await withStage(product, 'stage-singleton-di', async (base) => {
      const first = await (await send(base, '/stage?value=alpha&probe=1')).json();
      const second = await (await send(base, '/stage?value=beta&probe=1')).json();
      // Then
      assert.equal(first.reused, true);
      assert.equal(second.reused, true);
      assert.equal(first.instanceId, second.instanceId);
      assert.equal(second.doubled, 'betabeta');
    });
  });

  test(`${product} isolates overlapping requests and disposes each reused instance once`, { timeout: 20_000 }, async () => {
    // Given: subscribe before the requests; completion never relies on a delay.
    const created: number[] = [];
    const disposed: number[] = [];
    const lifecycle = new EventEmitter();
    StageService.onLifecycle = (event, id) => {
      if (event === 'create') created.push(id);
      else {
        disposed.push(id);
        if (disposed.length === 2) lifecycle.emit('disposed');
      }
    };
    try {
      await withStage(product, 'stage-request-di', async (base) => {
        const disposal = once(lifecycle, 'disposed', { signal: AbortSignal.timeout(10_000) });
        // When
        const [responses] = await Promise.all([
          Promise.all(['alpha', 'beta'].map(async (value) => (await send(base, `/stage?value=${value}&probe=1`)).json())),
          disposal,
        ]);
        // Then
        assert.equal(responses[0].reused, true);
        assert.equal(responses[1].reused, true);
        assert.notEqual(responses[0].instanceId, responses[1].instanceId);
        assert.deepEqual(created.sort(), responses.map((response) => response.instanceId).sort());
        assert.deepEqual(disposed.sort(), created.sort());
      });
    } finally { StageService.onLifecycle = undefined; }
  });
}

// Explicit real-host smoke, not performance traffic. Uses existing build/start APIs;
// the lead's runner selector remains outside this track's edit boundary.
if (process.env.BENCH_STAGE_HOSTS === '1') {
  test('all sixteen production targets serve stage and preserved business scenarios', { timeout: 900_000 }, async (t) => {
    for (const original of TARGETS) {
      await t.test(original.name, async () => {
        await buildTarget(original);
        // Give this target an OS-assigned port rather than a shared test port.
        const reservation = createServer();
        const ready = once(reservation, 'listening');
        reservation.listen(0, '127.0.0.1');
        await ready;
        const port = portOf(reservation);
        const closed = once(reservation, 'close');
        reservation.close();
        await closed;
        const target = { ...original, port, args: original.args.map((arg) => arg === String(original.port) ? String(port) : arg) };
        for (const scenario of [...STAGE_SCENARIOS, ...SCENARIOS]) {
          const children = startTargets(scenario.appShape, [target]);
          try {
            await waitForTarget(children[0]);
            const base = `http://127.0.0.1:${port}`;
            await assertScenarios(base, [scenario]);
            if (scenario.appShape === 'stage-guards') assert.equal((await send(base, '/stage?token=deny')).status, 403);
            if (scenario.appShape === 'stage-dto-validation') assert.equal((await send(base, '/stage', '{"name":"","quantity":0}')).status, 400);
          } finally { await stopTargets(children); }
        }
      });
    }
  });
}
