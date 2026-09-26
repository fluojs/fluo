import assert from 'node:assert/strict';
import { brotliCompressSync } from 'node:zlib';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStaticAssetsMiddleware } from '@fluojs/http';
import { BunHttpApplicationAdapter, createBunFileSystemAssetSource } from '@fluojs/platform-bun';
import { defineModule, FluoFactory } from '@fluojs/runtime';

const root = await mkdtemp(join(tmpdir(), 'fluo-bun-native-assets-'));
const outside = await mkdtemp(join(tmpdir(), 'fluo-bun-native-outside-'));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded(signal: Promise<void>, label: string): Promise<void> {
  await Promise.race([
    signal,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 3_000);
      void signal.finally(() => clearTimeout(timeout));
    }),
  ]);
}

let app: Awaited<ReturnType<typeof FluoFactory.create>> | undefined;
try {
  await writeFile(join(root, 'style.css'), 'body { color: red; }');
  await writeFile(join(root, 'app.js'), 'export const ready = true;');
  await writeFile(join(root, 'app.js.br'), brotliCompressSync('export const ready = true;'));
  await writeFile(join(root, 'favicon.ico'), Uint8Array.of(0, 1, 2, 3));
  await writeFile(join(root, '.env'), 'hidden');
  await writeFile(join(root, 'index.html'), '<h1>Index</h1>');
  await writeFile(join(root, 'cancel.txt'), 'cancel');
  await writeFile(join(outside, 'secret.js'), 'secret');
  await symlink(join(outside, 'secret.js'), join(root, 'linked.js'));

  assert.throws(() => createBunFileSystemAssetSource({ root: join(root, 'missing') }), TypeError);
  const filesystem = createBunFileSystemAssetSource({ root, precompressed: true });
  const entered = deferred();
  const aborted = deferred();
  const cleaned = deferred();
  const source = {
    async resolve(path: string, context: Parameters<typeof filesystem.resolve>[1]) {
      const asset = await filesystem.resolve(path, context);
      if (path !== 'cancel.txt' || !asset || 'notAcceptable' in asset) {
        return asset;
      }
      assert.ok(context.signal);
      const onAbort = () => aborted.resolve();
      context.signal.addEventListener('abort', onAbort, { once: true });
      entered.resolve();
      await bounded(aborted.promise, 'request abort');
      return {
        ...asset,
        dispose() {
          context.signal?.removeEventListener('abort', onAbort);
          cleaned.resolve();
        },
      };
    },
  };

  class AppModule {}
  defineModule(AppModule, {});
  const adapter = BunHttpApplicationAdapter.create({ hostname: '127.0.0.1', port: 0 });
  app = await FluoFactory.create(AppModule, {
    adapter,
    middleware: [createStaticAssetsMiddleware({
      cacheControl: 'public, max-age=120',
      dotfiles: 'deny',
      index: 'index.html',
      prefix: '/assets',
      source,
    })],
  });
  await app.listen();

  const base = adapter.getServer()?.url?.origin;
  assert.ok(base);
  const get = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);
  const css = await get('/assets/style.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(css.headers.get('content-length'), String('body { color: red; }'.length));
  assert.equal(css.headers.get('cache-control'), 'public, max-age=120');
  assert.equal(await css.text(), 'body { color: red; }');
  const etag = css.headers.get('etag');
  const modified = css.headers.get('last-modified');
  assert.ok(etag);
  assert.ok(modified);

  const head = await get('/assets/style.css', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), etag);
  assert.equal(head.headers.get('content-length'), css.headers.get('content-length'));
  assert.equal(await head.text(), '');
  assert.equal((await get('/assets/app.js')).headers.get('content-type'), 'application/javascript');
  assert.equal((await get('/assets/favicon.ico')).headers.get('content-type'), 'image/x-icon');
  assert.equal((await get('/assets/')).status, 200);
  assert.notEqual((await get('/assets')).status, 200);
  assert.equal((await get('/assets/missing.js')).status, 404);
  assert.equal((await get('/assets/linked.js')).status, 404);
  assert.equal((await get('/assets/.env')).status, 403);
  assert.equal((await get('/assets/%2e%2e%2fsecret.js')).status, 404);

  const unchanged = await get('/assets/style.css', { headers: { 'if-none-match': etag } });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.equal((await get('/assets/style.css', { headers: { 'if-modified-since': modified } })).status, 304);
  const failedPrecondition = await get('/assets/style.css', { headers: { 'if-match': '"wrong"' } });
  assert.equal(failedPrecondition.status, 412);
  assert.equal(await failedPrecondition.text(), '');
  const range = await get('/assets/style.css', { headers: { range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-3/${String('body { color: red; }'.length)}`);
  assert.equal(await range.text(), 'body');
  const staleRange = await get('/assets/style.css', { headers: { range: 'bytes=0-3', 'if-range': '"wrong"' } });
  assert.equal(staleRange.status, 200);
  assert.equal(await staleRange.text(), 'body { color: red; }');
  const unsatisfiable = await get('/assets/style.css', { headers: { range: 'bytes=999-' } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(await unsatisfiable.text(), '');
  const encoded = await get('/assets/app.js', { headers: { 'accept-encoding': 'br' } });
  assert.equal(encoded.headers.get('content-encoding'), 'br');
  assert.equal(encoded.headers.get('vary'), 'Accept-Encoding');
  await encoded.arrayBuffer();
  const unacceptable = await get('/assets/app.js', { headers: { 'accept-encoding': 'identity;q=0, br;q=0, gzip;q=0' } });
  assert.equal(unacceptable.status, 406);

  const controller = new AbortController();
  const request = get('/assets/cancel.txt', { signal: controller.signal });
  const rejected = assert.rejects(request);
  await bounded(entered.promise, 'cancellation source entry');
  controller.abort();
  await bounded(aborted.promise, 'source cancellation notification');
  await bounded(cleaned.promise, 'source cleanup');
  await rejected;
  console.log('Bun native static assets: GET/HEAD, MIME, containment, validators, ranges, encoding, cancellation passed');
} finally {
  await app?.close();
  await Promise.all([root, outside].map((directory) => rm(directory, { force: true, recursive: true })));
}
