import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';

test('Nest Express multer consumer: finite multipart HTTP -> preserves field and file bytes and completes', { timeout: 10_000 }, async () => {
  const require = createRequire(import.meta.url);
  const nestRequire = createRequire(require.resolve('@nestjs/platform-express'));
  const multer = nestRequire('multer');
  const upload = multer({ storage: multer.memoryStorage() }).single('attachment');
  const bytes = Buffer.from([0, 1, 127, 128, 255]);
  const server = createServer((request, response) => {
    upload(request, response, (error: unknown) => {
      if (error) {
        response.writeHead(500).end(String(error));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        body: 'body' in request ? request.body : null,
        file: 'file' in request ? request.file : null,
      }));
    });
  });
  const listening = once(server, 'listening', { signal: AbortSignal.timeout(5_000) });
  server.listen(0, '127.0.0.1');
  try {
    await listening;
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const form = new FormData();
    form.set('description', 'finite upload');
    form.set('attachment', new Blob([bytes]), 'bytes.bin');

    const response = await fetch(`http://127.0.0.1:${address.port}/upload`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(5_000),
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(result.body, { description: 'finite upload' });
    assert.equal(result.file.fieldname, 'attachment');
    assert.equal(result.file.originalname, 'bytes.bin');
    assert.equal(result.file.size, bytes.length);
    assert.deepEqual(result.file.buffer, { type: 'Buffer', data: [...bytes] });
  } finally {
    const closed = once(server, 'close', { signal: AbortSignal.timeout(5_000) });
    server.close();
    server.closeAllConnections();
    await closed;
  }
});
