import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { get } from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const suite = new URL('../', import.meta.url);
const appDirectory = new URL('apps/fluo/', suite);

async function exercise() {
  const require = createRequire(new URL('package.json', appDirectory));
  await import(new URL('node_modules/@fluojs/core/dist/metadata-preload.js', appDirectory));
  const { createServer } = await import(require.resolve('vite'));
  const { FluoFactory } = await import(require.resolve('@fluojs/runtime'));
  const { FastifyHttpApplicationAdapter } = await import(new URL('node_modules/@fluojs/platform-fastify/dist/index.js', appDirectory));
  const directory = await fs.mkdtemp(join(tmpdir(), 'fluo-static-assets-'));
  const originalRead = fs.readFile;
  const originalGzip = zlib.gzipSync;
  const reads = new Map();
  let compressions = 0;
  let release;
  let entered;
  let requestsEntered;
  let pendingRequests = 0;
  const readEntered = new Promise((resolve) => { entered = resolve; });
  const readReleased = new Promise((resolve) => { release = resolve; });
  const allRequestsEntered = new Promise((resolve) => { requestsEntered = resolve; });
  fs.readFile = async (file, ...args) => {
    const path = file instanceof URL ? fileURLToPath(file) : String(file);
    if (path.startsWith(directory)) {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      if (path.endsWith('/parallel.js')) {
        entered();
        await readReleased;
      }
    }
    return originalRead(file, ...args);
  };
  zlib.gzipSync = (...args) => {
    compressions++;
    return originalGzip(...args);
  };
  syncBuiltinESMExports();
  const vite = await createServer({
    root: fileURLToPath(appDirectory),
    configFile: fileURLToPath(new URL('vite.server.config.ts', appDirectory)),
    server: { middlewareMode: true, watch: null },
  });
  const apps = [];
  const request = (base, file, encoding = 'identity') => new Promise((resolve, reject) => {
    const req = get(`${base}/assets/${file}`, { headers: { 'accept-encoding': encoding } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
  const start = async (Module) => {
    const adapter = FastifyHttpApplicationAdapter.create({
      host: '127.0.0.1',
      port: 0,
      configureFastify(instance) {
        instance.addHook('onRequest', (request, _reply, done) => {
          if (request.url === '/assets/parallel.js' && ++pendingRequests === 8) requestsEntered();
          done();
        });
      },
    });
    const app = await FluoFactory.create(Module, { adapter });
    apps.push(app);
    await app.listen();
    return adapter.getListenTarget().url;
  };
  try {
    const { createBenchmarkModule } = await vite.ssrLoadModule('/src/app.ts');
    const manifest = Object.fromEntries([
      'entry-client', 'entry-server', 'navigation-catalog', 'navigation-product', 'navigation-jukebox', 'navigation-admin', 'parallel',
    ]
      .map((name) => [`src/${name}.ts`, {
        file: `${name}.js`,
        src: `src/${name}.ts`,
        ...(name.startsWith('entry-') ? { isEntry: true } : { isDynamicEntry: true }),
      }]));
    const client = pathToFileURL(`${directory}/`);
    const body = Buffer.from('export const payload = "immutable static payload";\n'.repeat(40));
    await fs.writeFile(new URL('parallel.js', client), body);
    const BenchmarkModule = createBenchmarkModule(manifest, client);
    const base = await start(BenchmarkModule);
    const parallel = Array.from({ length: 8 }, () => request(base, 'parallel.js', 'gzip'));
    await readEntered;
    await allRequestsEntered;
    release();
    const responses = await Promise.all(parallel);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers['content-encoding'], 'gzip');
      assert.equal(response.headers.vary, 'Accept-Encoding');
      assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(response.body, originalGzip(body));
      assert.deepEqual(zlib.gunzipSync(response.body), body);
    }
    assert.equal(reads.get(join(directory, 'parallel.js')), 1, 'concurrent HTTP requests share the real read');
    assert.equal(compressions, 1, 'concurrent HTTP requests share gzip bytes');
    const raw = await request(base, 'parallel.js');
    assert.deepEqual(raw.body, body);
    assert.equal(raw.headers['content-encoding'], undefined);
    assert.equal((await request(base, 'parallel.js', 'gzip;q=0')).headers['content-encoding'], 'gzip');
    assert.equal(compressions, 1, 'existing gzip negotiation remains unchanged');
    assert.equal(reads.get(join(directory, 'parallel.js')), 1, 'warm raw and gzip requests reuse the read');
    for (let index = 0; index < 2; index++) {
      assert.equal((await request(base, 'missing.js')).status, 404);
    }
    assert.equal(reads.get(join(directory, 'missing.js')), 2, 'rejected reads are evicted');
    await fs.writeFile(new URL('missing.js', client), body);
    assert.deepEqual((await request(base, 'missing.js')).body, body);
    const beforeInvalid = [...reads.values()].reduce((sum, count) => sum + count, 0);
    assert.equal((await request(base, 'invalid.txt')).status, 404);
    assert.equal((await request(base, '%2e%2e%2fsecret.js')).status, 404);
    assert.equal([...reads.values()].reduce((sum, count) => sum + count, 0), beforeInvalid);
    const otherBody = Buffer.from('export const payload = "second instance";');
    await fs.writeFile(new URL('parallel.js', client), otherBody);
    const other = await start(BenchmarkModule);
    assert.deepEqual((await request(other, 'parallel.js', 'gzip')).body, originalGzip(otherBody));
    assert.deepEqual((await request(base, 'parallel.js')).body, body);
    assert.equal(reads.get(join(directory, 'parallel.js')), 2, 'instances own independent reads');
    assert.equal(compressions, 2, 'instances own independent encodings');
    delete process.env.NODE_ENV;
    const { createReactViteExampleModule } = await vite.ssrLoadModule(
      fileURLToPath(new URL('../../../examples/react-vite-ssr/src/app.ts', suite)),
    );
    const ExampleModule = createReactViteExampleModule({ manifest, clientDirectory: client });
    const example = await start(ExampleModule);
    for (const [file, type, payload] of [
      ['style-abcdef.css', 'text/css; charset=utf-8', Buffer.from('body { color: blue; }')],
      ['image.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ]) {
      await fs.writeFile(new URL(file, client), payload);
      const path = join(directory, file);
      const responses = await Promise.all(Array.from({ length: 8 }, () => request(example, file, 'gzip')));
      for (const response of responses) {
        assert.equal(response.status, 200);
        assert.equal(response.headers['content-type'], type);
        assert.equal(response.headers['content-encoding'], undefined);
        assert.equal(response.headers.vary, undefined);
        assert.equal(response.headers['cache-control'], file.endsWith('.css')
          ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
        assert.deepEqual(response.body, payload);
      }
      await request(example, file);
      assert.equal(reads.get(path), 1, 'example reuses raw bytes without adding compression');
    }
    assert.equal(compressions, 2);
    for (let index = 0; index < 2; index++) {
      const missing = await request(example, 'example-missing.js');
      assert.equal(missing.status, 404);
      assert.equal(missing.headers['x-fluo-asset-status'], 'missing');
    }
    assert.equal(reads.get(join(directory, 'example-missing.js')), 2);
    const secondExample = await start(ExampleModule);
    const replacement = Buffer.from('body { color: red; }');
    await fs.writeFile(new URL('style-abcdef.css', client), replacement);
    assert.deepEqual((await request(secondExample, 'style-abcdef.css')).body, replacement);
    assert.equal(reads.get(join(directory, 'style-abcdef.css')), 2);
    assert.notDeepEqual((await request(example, 'style-abcdef.css')).body, replacement);
    const development = await start(createBenchmarkModule(undefined, client, vite));
    assert.deepEqual((await request(development, 'parallel.js')).body, otherBody);
    await fs.writeFile(new URL('parallel.js', client), body);
    assert.deepEqual((await request(development, 'parallel.js')).body, body);
    assert.equal(reads.get(join(directory, 'parallel.js')), 4, 'development does not retain mutable assets');
    console.log('STATIC_REUSE_HTTP_PASS concurrent=8 reads=2 gzip=2 missing-retry=pass isolation=pass');
  } finally {
    release();
    await Promise.all(apps.map((app) => app.close()));
    await vite.close();
    fs.readFile = originalRead;
    zlib.gzipSync = originalGzip;
    syncBuiltinESMExports();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

if (process.env.FLUO_STATIC_ASSET_CHILD === '1') {
  await exercise();
} else {
  test('production static assets preserve real HTTP payloads while reusing reads and gzip per instance', { timeout: 60_000 }, async () => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: fileURLToPath(appDirectory),
      env: { ...process.env, NODE_ENV: 'production', FLUO_STATIC_ASSET_CHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 55_000);
    try {
      const [code] = await exited;
      assert.equal(code, 0, output);
      assert.match(output, /STATIC_REUSE_HTTP_PASS/u);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  });
}
