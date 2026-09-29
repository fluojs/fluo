import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveSandboxProfile, verifyReactColdDev } from './local-test-env.mjs';

test('accepts only the full and smoke verification profiles', () => {
  // Given / When / Then
  assert.equal(resolveSandboxProfile({}), 'full');
  assert.equal(resolveSandboxProfile({ FLUO_CLI_SANDBOX_PROFILE: 'smoke' }), 'smoke');
  assert.equal(resolveSandboxProfile({ FLUO_CLI_SANDBOX_PROFILE: 'full' }), 'full');
  assert.throws(() => resolveSandboxProfile({ FLUO_CLI_SANDBOX_PROFILE: 'skip' }), /profile/u);
});

function coldDevFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-starter-profile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), '{"name":"starter-profile-fixture","type":"module"}');
  writeFileSync(join(root, 'src/app.ts'), "@Router('/products')");
  writeFileSync(join(root, 'src/page.tsx'), 'Catalog item');
  const executable = join(root, 'node_modules/.bin/fluo');
  writeFileSync(executable, `#!${process.execPath}
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, watch } from 'node:fs';
const sockets = new Set();
const watcher = watch('src', (_event, path) => {
  if (path === 'app.ts') console.log('React dev app ready');
  if (path === 'page.tsx') {
    const message = Buffer.from(JSON.stringify({ type: 'update', updates: [{ path: '/src/page.tsx' }] }));
    for (const socket of sockets) socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
  }
});
const server = createServer((request, response) => {
  if (request.url.startsWith('/src/')) {
    response.setHeader('content-type', 'text/javascript');
    response.end(request.url.startsWith('/src/page.tsx') ? readFileSync('src/page.tsx', 'utf8') : 'export {};');
    return;
  }
  const prefix = readFileSync('src/app.ts', 'utf8').includes('/dev-products') ? '/dev-products' : '/products';
  if (!request.url.startsWith(prefix + '/')) { response.writeHead(404); response.end(); return; }
  response.setHeader('content-type', 'text/html');
  response.end('<h1>' + readFileSync('src/page.tsx', 'utf8') + ' sku-42</h1><script type="module" src="/src/entry-client-dev.ts"></script>');
});
server.on('upgrade', (request, socket) => {
  const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Protocol: vite-hmr\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('React dev app ready'));
process.once('SIGINT', () => { watcher.close(); for (const socket of sockets) socket.destroy(); server.close(() => process.exit(0)); });
`);
  chmodSync(executable, 0o755);
  return root;
}

test('smoke verifies cold HTTP, assets, file edits and shutdown without a browser dependency', { timeout: 30_000 }, async (t) => {
  // Given: a real subprocess and HTTP server, with no Playwright installation.
  const root = coldDevFixture(t);

  // When
  await verifyReactColdDev(root, 'smoke');

  // Then: the verifier completed the same source edits and restored the input.
  assert.equal(readFileSync(join(root, 'src/app.ts'), 'utf8'), "@Router('/products')");
  assert.equal(readFileSync(join(root, 'src/page.tsx'), 'utf8'), 'Catalog item');
});

test('full verification requires the browser instead of silently degrading to smoke', { timeout: 30_000 }, async (t) => {
  // Given
  const root = coldDevFixture(t);

  // When / Then
  await assert.rejects(verifyReactColdDev(root, 'full'), /@playwright\/test/u);
});
