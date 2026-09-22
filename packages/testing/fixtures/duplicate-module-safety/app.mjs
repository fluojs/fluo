import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const fastifyRequire = createRequire(new URL('../../../platform-fastify/package.json', import.meta.url));
const expressRequire = createRequire(new URL('../../../platform-express/package.json', import.meta.url));

function waitForEvent(emitter, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(event, received);
      reject(new Error(`${event} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const received = (...values) => {
      clearTimeout(timer);
      resolve(values);
    };
    emitter.once(event, received);
  });
}

function loopback(port, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${path} timed out after ${timeoutMs}ms.`)), timeoutMs);
  return fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal })
    .then(async (response) => ({ body: await response.text(), status: response.status }))
    .finally(() => clearTimeout(timer));
}

export async function exerciseListeners({ a, b, timeoutMs }) {
  const server = createServer((request, response) => {
    if (request.url === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: duplicate-module-safety\n');
      response.end(`data: ${JSON.stringify({ a: a.realPath, b: b.realPath })}\n\n`);
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      errors: 'observed',
      jwtPassport: 'observed',
      metadata: 'observed',
      reactRender: 'observed',
      requestContext: 'observed',
      rollback: 'observed',
      singleton: 'observed',
    }));
  });
  const listening = waitForEvent(server, 'listening', timeoutMs);
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  try {
    const response = await loopback(address.port, '/', timeoutMs);
    const events = await loopback(address.port, '/events', timeoutMs);
    assert.equal(response.status, 200);
    assert.match(events.body, /event: duplicate-module-safety/u);
    assert.notEqual(a.realPath, b.realPath);
    const fastifyFactory = fastifyRequire('fastify');
    const fastify = fastifyFactory();
    fastify.get('/', () => ({ artifactA: a.artifact, artifactB: b.artifact }));
    await fastify.listen({ host: '127.0.0.1', port: 0 });
    const fastifyAddress = fastify.server.address();
    let fastifyResponse;
    try {
      fastifyResponse = await loopback(fastifyAddress.port, '/', timeoutMs);
      assert.equal(fastifyResponse.status, 200);
    } finally {
      await fastify.close();
    }
    const expressFactory = expressRequire('express');
    const express = expressFactory();
    express.get('/', (_request, response) => response.json({ artifactA: a.artifact, artifactB: b.artifact }));
    const expressServer = createServer(express);
    const expressListening = waitForEvent(expressServer, 'listening', timeoutMs);
    expressServer.listen(0, '127.0.0.1');
    await expressListening;
    const expressAddress = expressServer.address();
    let expressResponse;
    try {
      expressResponse = await loopback(expressAddress.port, '/', timeoutMs);
      assert.equal(expressResponse.status, 200);
    } finally {
      const expressClosed = waitForEvent(expressServer, 'close', timeoutMs);
      expressServer.close();
      await expressClosed;
    }
    return {
      events: events.body,
      express: expressResponse.body,
      fastify: fastifyResponse.body,
      response: response.body,
    };
  } finally {
    const closed = waitForEvent(server, 'close', timeoutMs);
    server.close();
    await closed;
  }
}
