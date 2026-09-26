import assert from 'node:assert/strict';
import { createServer } from 'node:http';

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
      copies: {
        a: a.surfaces,
        b: b.surfaces,
      },
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
    assert.equal(JSON.parse(response.body).copies.a.error, 'DUPLICATE_MODULE_SAFETY');
    assert.equal(JSON.parse(response.body).copies.b.error, 'DUPLICATE_MODULE_SAFETY');
    assert.equal(JSON.parse(response.body).copies.a.singleton, true);
    assert.equal(JSON.parse(response.body).copies.b.requestScope, true);
    assert.match(events.body, /event: duplicate-module-safety/u);
    assert.notEqual(a.realPath, b.realPath);
    return {
      events: events.body,
      response: response.body,
    };
  } finally {
    const closed = waitForEvent(server, 'close', timeoutMs);
    server.close();
    await closed;
  }
}
