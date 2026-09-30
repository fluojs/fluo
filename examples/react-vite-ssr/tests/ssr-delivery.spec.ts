import { spawn } from 'node:child_process';
import { createServer, request as requestHttp, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, createGunzip, createGzip, gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

test('built Fastify product route sends a socket shell before the gated descendant', async () => {
  // Given: the production example build with the optional local delivery probe enabled.
  const server = spawn(process.execPath, ['dist/server/main.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, REACT_SSR_DELIVERY_PROBE: '1', REACT_VITE_EXAMPLE_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let ready: (port: number) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const portReady = new Promise<number>((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const serverExited = new Promise<void>((resolve) => {
    server.once('exit', () => resolve());
  });
  server.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    const match = /Listening on http:\/\/127\.0\.0\.1:(\d+)/u.exec(output);
    if (match) ready(Number(match[1]));
  });
  server.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  server.once('exit', (code) => rejectReady(new Error(`Built Fastify exited ${code}: ${output}`)));
  let client: ReturnType<typeof requestHttp> | undefined;
  let response: IncomingMessage | undefined;
  const proxies: Server[] = [];
  const proxyClients: ReturnType<typeof requestHttp>[] = [];
  try {
    const port = await Promise.race([
      portReady,
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error(`Built Fastify readiness timed out: ${output}`)), { once: true });
      }),
    ]);
    let firstShell: (value: { readonly response: IncomingMessage; readonly html: string }) => void = () => {};
    let finish: (html: string) => void = () => {};
    const shellReceived = new Promise<{ readonly response: IncomingMessage; readonly html: string }>((resolve) => {
      firstShell = resolve;
    });
    const completed = new Promise<string>((resolve) => {
      finish = resolve;
    });
    client = requestHttp({ host: '127.0.0.1', port, path: '/products/sku-42?preview=true' });
    client.on('response', (incoming) => {
      response = incoming;
      let html = '';
      incoming.on('data', (chunk: Buffer) => {
        html += chunk.toString('utf8');
        if (html.includes('Loading recommendations')) firstShell({ response: incoming, html });
      });
      incoming.on('end', () => finish(html));
    });
    client.end();

    // When: the real Node socket receives the shell while the descendant is still held.
    const early = await Promise.race([
      shellReceived,
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error('The built production socket did not deliver a pre-gate shell.')), { once: true });
      }),
    ]);

    // Then: middleware, HTTP status, HTML, CSP, and build-produced assets survive this route.
    expect(early.response.statusCode).toBe(200);
    expect(early.response.headers['content-type']).toContain('text/html');
    expect(early.response.headers['x-example-middleware']).toBe('react-native-form');
    expect(early.response.headers['content-security-policy']).toContain('nonce-');
    expect(early.html).toContain('Catalog item sku-42');
    expect(early.html).toContain('Loading recommendations');
    expect(early.html).not.toContain('Recommended for sku-42');
    const asset = await fetch(`http://127.0.0.1:${port}/assets/entry-client.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');

    // The same built route now travels through both documented gzip proxy modes.
    let streamingUpstream: () => void = () => {};
    let bufferedUpstream: () => void = () => {};
    const streamingUpstreamReceived = new Promise<void>((resolve) => { streamingUpstream = resolve; });
    const bufferedUpstreamReceived = new Promise<void>((resolve) => { bufferedUpstream = resolve; });
    const createProxy = (buffered: boolean) => createServer((_request, downstream) => {
      const upstream = requestHttp({ host: '127.0.0.1', port, path: '/products/sku-42?preview=true' });
      upstream.on('response', (incoming) => {
        const headers = {
          'content-encoding': 'gzip',
          'content-type': incoming.headers['content-type'] ?? 'text/html',
          vary: 'Accept-Encoding',
        };
        incoming.once('data', buffered ? bufferedUpstream : streamingUpstream);
        if (buffered) {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.once('end', () => {
            downstream.writeHead(incoming.statusCode ?? 502, headers);
            downstream.end(gzipSync(Buffer.concat(chunks)));
          });
        } else {
          downstream.writeHead(incoming.statusCode ?? 502, headers);
          incoming.pipe(createGzip({ flush: zlibConstants.Z_SYNC_FLUSH })).pipe(downstream);
        }
      });
      upstream.end();
    });
    const streamingProxy = createProxy(false);
    const bufferedProxy = createProxy(true);
    proxies.push(streamingProxy, bufferedProxy);
    await Promise.all(proxies.map((proxy) => new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    })));
    const streamingAddress = streamingProxy.address() as AddressInfo;
    const bufferedAddress = bufferedProxy.address() as AddressInfo;
    let receiveStreamedShell: (html: string) => void = () => {};
    let finishStreamed: (html: string) => void = () => {};
    let finishBuffered: (html: string) => void = () => {};
    const streamedShell = new Promise<string>((resolve) => { receiveStreamedShell = resolve; });
    const streamedDone = new Promise<string>((resolve) => { finishStreamed = resolve; });
    const bufferedDone = new Promise<string>((resolve) => { finishBuffered = resolve; });
    let released = false;
    let bufferedArrivedBeforeRelease = false;
    const streamedClient = requestHttp({ host: '127.0.0.1', port: streamingAddress.port, path: '/' });
    proxyClients.push(streamedClient);
    streamedClient.on('response', (incoming) => {
      expect(incoming.headers['content-encoding']).toBe('gzip');
      const decoded = createGunzip();
      let html = '';
      incoming.pipe(decoded);
      decoded.on('data', (chunk: Buffer) => {
        html += chunk.toString('utf8');
        if (html.includes('Loading recommendations')) receiveStreamedShell(html);
      });
      decoded.once('end', () => finishStreamed(html));
    });
    const bufferedClient = requestHttp({ host: '127.0.0.1', port: bufferedAddress.port, path: '/' });
    proxyClients.push(bufferedClient);
    bufferedClient.on('response', (incoming) => {
      bufferedArrivedBeforeRelease = !released;
      expect(incoming.headers['content-encoding']).toBe('gzip');
      const decoded = createGunzip();
      let html = '';
      incoming.pipe(decoded);
      decoded.on('data', (chunk: Buffer) => { html += chunk.toString('utf8'); });
      decoded.once('end', () => finishBuffered(html));
    });
    streamedClient.end();
    bufferedClient.end();
    const earlyCompressed = await Promise.race([
      streamedShell,
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error('Flushed gzip proxy did not deliver a pre-gate shell.')), { once: true });
      }),
    ]);
    await Promise.race([
      Promise.all([streamingUpstreamReceived, bufferedUpstreamReceived]),
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error('Compressed production upstream sources did not produce bytes.')), { once: true });
      }),
    ]);
    expect(earlyCompressed).toContain('Catalog item sku-42');
    expect(bufferedArrivedBeforeRelease).toBe(false);

    released = true;
    const release = await fetch(`http://127.0.0.1:${port}/__delivery-probe/release`, { method: 'POST' });
    expect(release.ok).toBe(true);
    const finalHtml = await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error('The released production response did not finish.')), { once: true });
      }),
    ]);
    expect(finalHtml).toContain('Recommended for sku-42');
    const [streamedHtml, bufferedHtml] = await Promise.race([
      Promise.all([streamedDone, bufferedDone]),
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error('The compressed production responses did not finish.')), { once: true });
      }),
    ]);
    expect(streamedHtml).toContain('Recommended for sku-42');
    expect(bufferedHtml).toContain('Recommended for sku-42');
    expect(bufferedArrivedBeforeRelease).toBe(false);
    console.info(`BUILT_PROXY_EVIDENCE ${JSON.stringify({
      route: '/products/sku-42?preview=true',
      flushedGzipShellBeforeRelease: true,
      wholeBodyGzipBeforeRelease: bufferedArrivedBeforeRelease,
      middleware: early.response.headers['x-example-middleware'],
      assetStatus: asset.status,
    })}`);
  } finally {
    response?.destroy();
    client?.destroy();
    for (const proxyClient of proxyClients) proxyClient.destroy();
    await Promise.all(proxies.map((proxy) => new Promise<void>((resolve) => {
      proxy.closeAllConnections();
      proxy.close(() => resolve());
    })));
    server.kill('SIGTERM');
    await Promise.race([
      serverExited,
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(10_000).addEventListener('abort', () =>
          reject(new Error('The built Fastify probe server did not exit.')), { once: true });
      }),
    ]);
  }
});
