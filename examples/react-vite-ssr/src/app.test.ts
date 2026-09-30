import { createServer, request as requestHttp, ServerResponse, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { constants as zlibConstants, createGunzip, createGzip, gzipSync } from 'node:zlib';

import { Inject, Module, Scope } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { Path, ReactModule, Router, createReactServerEntry, renderReactResponse } from '@fluojs/react';
import { Test } from '@fluojs/testing';
import { Suspense, createElement, use } from 'react';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { createReactViteExampleModule } from './app';

const VITE_MANIFEST = {
  'src/entry-client.ts': {
    css: ['example.css'],
    file: 'entry-client.js',
    imports: ['src/entry-server.ts'],
    isEntry: true,
    src: 'src/entry-client.ts',
  },
  'src/entry-server.ts': {
    file: 'entry-server.js',
    isEntry: true,
    src: 'src/entry-server.ts',
  },
  'src/navigation-product.ts': {
    file: 'navigation-product-hash.js',
    isDynamicEntry: true,
    src: 'src/navigation-product.ts',
  },
  'src/navigation-admin.ts': {
    file: 'navigation-admin-hash.js',
    isDynamicEntry: true,
    src: 'src/navigation-admin.ts',
  },
} as const;

const TEXT_DECODER = new TextDecoder();
const assets = createReactViteAssetManifest({
  base: '/assets/',
  entries: { client: 'src/entry-client.ts', server: 'src/entry-server.ts' },
  manifest: VITE_MANIFEST,
});
if (!assets.ok) throw new Error('The test manifest must be valid.');

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function bounded<T>(promise: Promise<T>, event = 'socket event'): Promise<T> {
  let deadline: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`${event} deadline expired.`)), 5_000);
    }),
  ]).finally(() => clearTimeout(deadline));
}

function openSocket(port: number, path: string) {
  const firstChunk = deferred<{ readonly response: IncomingMessage; readonly chunk: string }>();
  const complete = deferred<string>();
  const client = requestHttp({ host: '127.0.0.1', port, path });
  client.on('response', (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.length === 1) {
        firstChunk.resolve({ response, chunk: chunk.toString('utf8') });
      }
    });
    response.on('end', () => complete.resolve(Buffer.concat(chunks).toString('utf8')));
  });
  client.end();
  return { client, firstChunk: firstChunk.promise, complete: complete.promise };
}

function readHtml(body: unknown): string {
  if (body instanceof Uint8Array) {
    return TEXT_DECODER.decode(body);
  }

  return typeof body === 'string' ? body : JSON.stringify(body);
}

describe('react-vite-ssr example', () => {
  it('delivers the HTTP-owned shell through a real Fastify socket before a gated descendant settles', async () => {
    // Given: the ordinary React HTTP module with a Suspense descendant controlled independently of the handler.
    const gate = deferred<void>();
    let descendantResolved = false;
    function Descendant() {
      use(gate.promise);
      descendantResolved = true;
      return createElement('p', null, 'Descendant ready');
    }

    @Router('/socket-shell')
    class ShellRouter {
      @Path('/')
      show() {
        return createReactServerEntry(createElement('html', null,
          createElement('body', null,
            createElement('h1', null, 'Shell received'),
            createElement(Suspense, { fallback: createElement('p', null, 'Descendant pending') },
              createElement(Descendant)))));
      }
    }

    @Module({ imports: [ReactModule.forRoot({ controllers: [ShellRouter] })] })
    class ShellModule {}

    const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(ShellModule, { adapter });
    await app.listen();
    const address = (adapter.getServer() as { address: () => AddressInfo | string | null }).address();
    if (typeof address !== 'object' || address === null) throw new TypeError('Expected a bound Fastify listener.');

    const socket = openSocket(address.port, '/socket-shell');
    try {
      // When: the client receives bytes while the descendant gate is still held.
      const { response, chunk } = await bounded(socket.firstChunk);

      // Then: the actual HTTP status and shell bytes precede descendant completion.
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(chunk).toContain('Shell received');
      expect(chunk).toContain('Descendant pending');
      expect(descendantResolved).toBe(false);
      gate.resolve();
      expect(await bounded(socket.complete)).toContain('Descendant ready');
    } finally {
      gate.resolve();
      socket.client.destroy();
      await app.close();
    }
  });

  it('does not promise socket shell bytes before a required handler await resolves', async () => {
    // Given: HTTP-owned handler work that must finish before React receives its page entry.
    const gate = deferred<void>();
    const enteredHandler = deferred<void>();
    @Router('/awaited-shell')
    class AwaitedRouter {
      @Path('/')
      async show() {
        enteredHandler.resolve();
        await gate.promise;
        return createReactServerEntry(createElement('h1', null, 'Awaited shell'));
      }
    }
    @Module({ imports: [ReactModule.forRoot({ controllers: [AwaitedRouter] })] })
    class AwaitedModule {}
    const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(AwaitedModule, { adapter });
    await app.listen();
    const address = (adapter.getServer() as { address: () => AddressInfo | string | null }).address();
    if (typeof address !== 'object' || address === null) throw new TypeError('Expected a bound Fastify listener.');
    const socket = openSocket(address.port, '/awaited-shell');
    try {
      // When: the handler has begun but its required data is still gated.
      await bounded(enteredHandler.promise);
      gate.resolve();

      // Then: the delivered HTML is the result of the completed handler, not proof of pre-await streaming.
      const { response, chunk } = await bounded(socket.firstChunk);
      expect(response.statusCode).toBe(200);
      expect(chunk).toContain('Awaited shell');
      expect(await bounded(socket.complete)).toContain('Awaited shell');
    } finally {
      gate.resolve();
      socket.client.destroy();
      await app.close();
    }
  });

  it('delivers a gzip-flushed shell through a streaming proxy but labels whole-body gzip as buffered', async () => {
    // Given: one Fastify React page with an independently gated Suspense descendant.
    const gate = deferred<void>();
    let gateReleased = false;
    function Descendant() {
      use(gate.promise);
      return createElement('p', null, 'After gate');
    }
    @Router('/proxy-shell')
    class ProxyRouter {
      @Path('/')
      show() {
        return createReactServerEntry(createElement('html', null,
          createElement('body', null, createElement('h1', null, 'Early proxy shell'),
            createElement(Suspense, { fallback: createElement('p', null, 'Pending proxy descendant') },
              createElement(Descendant)))));
      }
    }
    @Module({ imports: [ReactModule.forRoot({ controllers: [ProxyRouter] })] })
    class ProxyModule {}
    const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(ProxyModule, { adapter });
    await app.listen();
    const upstreamAddress = (adapter.getServer() as { address: () => AddressInfo | string | null }).address();
    if (typeof upstreamAddress !== 'object' || upstreamAddress === null) throw new TypeError('Expected an upstream listener.');
    const streamingUpstreamData = deferred<void>();
    const bufferedUpstreamData = deferred<void>();
    const streaming = createServer((_request, downstream) => {
      const upstream = requestHttp({ host: '127.0.0.1', port: upstreamAddress.port, path: '/proxy-shell' });
      upstream.on('response', (response) => {
        downstream.writeHead(response.statusCode ?? 502, {
          'content-encoding': 'gzip',
          'content-type': response.headers['content-type'] ?? 'text/html',
          vary: 'Accept-Encoding',
        });
        const gzip = createGzip({ flush: zlibConstants.Z_SYNC_FLUSH });
        response.once('data', () => streamingUpstreamData.resolve());
        response.pipe(gzip).pipe(downstream);
      });
      upstream.end();
    });
    const buffered = createServer((_request, downstream) => {
      const upstream = requestHttp({ host: '127.0.0.1', port: upstreamAddress.port, path: '/proxy-shell' });
      upstream.on('response', (response) => {
        const chunks: Buffer[] = [];
        response.once('data', () => bufferedUpstreamData.resolve());
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          downstream.writeHead(response.statusCode ?? 502, { 'content-encoding': 'gzip' });
          downstream.end(gzipSync(Buffer.concat(chunks)));
        });
      });
      upstream.end();
    });
    await Promise.all([new Promise<void>((resolve) => streaming.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => buffered.listen(0, '127.0.0.1', resolve))]);
    const streamingAddress = streaming.address();
    const bufferedAddress = buffered.address();
    if (typeof streamingAddress !== 'object' || streamingAddress === null
      || typeof bufferedAddress !== 'object' || bufferedAddress === null) throw new TypeError('Expected proxy listeners.');
    const streamedFirstHtml = deferred<string>();
    const streamedComplete = deferred<string>();
    const streamedClient = requestHttp({ host: '127.0.0.1', port: streamingAddress.port, path: '/' });
    streamedClient.on('response', (response) => {
      if (response.headers['content-encoding'] !== 'gzip') {
        throw new TypeError('Expected gzip at the streaming proxy.');
      }
      const gunzip = createGunzip();
      const chunks: Buffer[] = [];
      response.pipe(gunzip);
      gunzip.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        if (chunks.length === 1) streamedFirstHtml.resolve(chunk.toString('utf8'));
      });
      gunzip.on('end', () => streamedComplete.resolve(Buffer.concat(chunks).toString('utf8')));
    });
    streamedClient.end();
    let bufferedArrivedBeforeRelease = false;
    const bufferedClient = requestHttp({ host: '127.0.0.1', port: bufferedAddress.port, path: '/' });
    const bufferedComplete = deferred<Buffer>();
    bufferedClient.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        if (!gateReleased) bufferedArrivedBeforeRelease = true;
        chunks.push(chunk);
      });
      response.on('end', () => bufferedComplete.resolve(Buffer.concat(chunks)));
    });
    bufferedClient.end();
    try {
      // When: the streaming client receives compressed bytes before releasing the descendant.
      const first = await bounded(streamedFirstHtml.promise, 'streaming proxy first decoded shell byte');
      expect(first).toContain('Early proxy shell');
      await bounded(Promise.all([streamingUpstreamData.promise, bufferedUpstreamData.promise]), 'both proxy upstream bytes');
      expect(gateReleased).toBe(false);
      expect(bufferedArrivedBeforeRelease).toBe(false);
      gateReleased = true;
      gate.resolve();

      // Then: both hosts complete, but whole-body gzip did not supply a pre-gate client chunk.
      expect(await bounded(streamedComplete.promise, 'streaming proxy completion')).toContain('After gate');
      expect((await bounded(bufferedComplete.promise, 'buffered proxy completion')).byteLength).toBeGreaterThan(0);
      expect(bufferedArrivedBeforeRelease).toBe(false);
    } finally {
      gate.resolve();
      streamedClient.destroy();
      bufferedClient.destroy();
      await Promise.all([new Promise<void>((resolve, reject) => streaming.close((error) => error ? reject(error) : resolve())),
        new Promise<void>((resolve, reject) => buffered.close((error) => error ? reject(error) : resolve()))]);
      await app.close();
    }
  });

  for (const blockedAt of ['source-read', 'socket-drain'] as const) {
    it(`cancels the unfinished reader and disposes its request scope after ${blockedAt} disconnect`, async () => {
      // Given: a real Node response, a controlled HWM=0 producer, and a request-owned provider.
      const canceled = deferred<void>();
      const disposed = deferred<void>();
      const writeBlocked = deferred<{ readonly highWaterMark: number; readonly writableLength: number }>();
      const sourceRead = deferred<void>();
      const releaseRead = deferred<void>();
      const responseClosed = deferred<void>();
      let pulls = 0;
      let cancellations = 0;
      let disposals = 0;
      let drains = 0;
      let readCalls = 0;
      let readsInFlight = 0;
      let maximumReadsInFlight = 0;
      let readCallsAtWriteFalse = 0;
      let sourceDesiredSize: number | null | undefined;
      let blockedSize: { readonly highWaterMark: number; readonly writableLength: number } | undefined;
      let source: ReadableStream<Uint8Array> | undefined;
      @Scope('request')
      class RequestOwner {
        onDestroy() {
          disposals++;
          disposed.resolve();
        }
      }
      @Inject(RequestOwner)
      @Scope('request')
      @Controller('/slow-socket')
      class SlowSocketController {
        constructor(private readonly owner: RequestOwner) {}

        @Get('/')
        async stream(_input: undefined, context: RequestContext) {
          void this.owner;
          const reply = context.response.raw;
          if (typeof reply !== 'object' || reply === null) throw new TypeError('Expected a Fastify reply.');
          const native: unknown = Reflect.get(reply, 'raw');
          if (!(native instanceof ServerResponse)) throw new TypeError('Expected a Node Fastify response.');
          native.once('close', () => responseClosed.resolve());
          native.on('drain', () => { drains++; });
          const sink = context.response.stream;
          if (!sink) throw new TypeError('Expected a Fastify streaming response.');
          const write = sink.write.bind(sink);
          sink.write = (chunk) => {
            const accepted = write(chunk);
            if (!accepted) {
              readCallsAtWriteFalse = readCalls;
              writeBlocked.resolve({
                highWaterMark: native.writableHighWaterMark,
                writableLength: native.writableLength,
              });
            }
            return accepted;
          };
          const readable = new ReadableStream<Uint8Array>({
            cancel() {
              cancellations++;
              releaseRead.resolve();
              canceled.resolve();
            },
            async pull(controller) {
              pulls++;
              sourceDesiredSize = controller.desiredSize;
              if (blockedAt === 'socket-drain') {
                controller.enqueue(new Uint8Array(4 * 1024 * 1024).fill(65));
                return;
              }
              if (pulls === 1) {
                controller.enqueue(new TextEncoder().encode('<main>first shell byte</main>'));
                return;
              }
              sourceRead.resolve();
              await releaseRead.promise;
            },
          }, { highWaterMark: 0 });
          const getReader = readable.getReader.bind(readable);
          Object.defineProperty(readable, 'getReader', {
            value: () => {
              const reader = getReader();
              const read = reader.read.bind(reader);
              reader.read = async () => {
                readCalls++;
                readsInFlight++;
                maximumReadsInFlight = Math.max(maximumReadsInFlight, readsInFlight);
                try {
                  return await read();
                } finally {
                  readsInFlight--;
                }
              };
              return reader;
            },
          });
          source = readable;
          await renderReactResponse(createReactServerEntry(createElement('main')), context, {
            renderToReadableStream: async () => readable,
          });
        }
      }
      @Module({ controllers: [SlowSocketController], providers: [RequestOwner] })
      class SlowSocketModule {}
      const adapter = FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
      const app = await FluoFactory.create(SlowSocketModule, { adapter });
      await app.listen();
      const address = (adapter.getServer() as { address: () => AddressInfo | string | null }).address();
      if (typeof address !== 'object' || address === null) throw new TypeError('Expected a bound Fastify listener.');
      const socket = requestHttp({ host: '127.0.0.1', port: address.port, path: '/slow-socket' });
      const responseReady = deferred<IncomingMessage>();
      socket.on('response', (response) => {
        if (blockedAt === 'socket-drain') response.pause();
        responseReady.resolve(response);
      });
      socket.end();
      try {
        // When: the reader is pending or a genuine socket write reports backpressure, disconnect the client.
        const response = await bounded(responseReady.promise, 'response headers');
        expect(response.statusCode).toBe(200);
        if (blockedAt === 'source-read') {
          response.resume();
          await bounded(sourceRead.promise, 'pending source read');
        } else {
          const blocked = await bounded(writeBlocked.promise, 'socket write false');
          blockedSize = blocked;
          expect(blocked.writableLength).toBeGreaterThanOrEqual(blocked.highWaterMark);
          expect(pulls).toBe(1);
        }
        socket.destroy();

        // Then: no producer read escapes blocked drain, and all request-owned work ends exactly once.
        await bounded(responseClosed.promise, 'response close');
        await bounded(canceled.promise, 'reader cancellation');
        await bounded(disposed.promise, 'request disposal');
        expect(cancellations).toBe(1);
        expect(disposals).toBe(1);
        expect(source?.locked).toBe(false);
        expect(maximumReadsInFlight).toBe(1);
        expect(readsInFlight).toBe(0);
        expect(socket.destroyed).toBe(true);
        if (blockedAt === 'socket-drain') {
          expect(pulls).toBe(1);
          expect(readCalls).toBe(readCallsAtWriteFalse);
        }
        console.info('SLOW_SOCKET_EVIDENCE', JSON.stringify({
          blockedAt, highWaterMark: blockedSize?.highWaterMark ?? null,
          writableLengthAtFalse: blockedSize?.writableLength ?? null,
          sourceChunkBytes: blockedAt === 'socket-drain' ? 4 * 1024 * 1024 : 29,
          pulls, drains, cancellations, disposals, readerLocked: source?.locked,
          readCalls, readCallsAtWriteFalse, maximumReadsInFlight, readsInFlight,
          sourceHighWaterMark: 0, sourceDesiredSize,
        }));
      } finally {
        socket.destroy();
        await app.close();
      }
    }, 15_000);
  }

  it('reports a missing application page renderer through real request dispatch', async () => {
    // Given: an explicit React page returns one element without configuring renderPage.
    const diagnostics: string[] = [];

    @Router('/missing-renderer')
    class MissingRendererRouter {
      @Path('/')
      show() {
        return createElement('main', null, 'Missing renderer');
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [MissingRendererRouter],
        onDiagnostic(diagnostic) {
          diagnostics.push(diagnostic.code);
        },
      })],
    })
    class MissingRendererModule {}

    const app = await Test.createApp({ rootModule: MissingRendererModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the virtual HTTP client dispatches the page request.
      const response = await app.request('GET', '/missing-renderer/').send();

      // Then: HTTP owns the failure response and React emits its stable configuration diagnostic.
      expect(response.status).toBe(500);
      expect(diagnostics).toEqual(['react-ssr-missing-page-renderer']);
    });
  });

  it('streams a DTO-bound page with Vite hydration assets', async () => {
    // Given: a fluo React module backed by a loaded Vite manifest.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the HTTP-owned route receives path and search parameters.
      const response = await app.request('GET', '/products/sku-42').query('preview', 'true').send();
      const html = readHtml(response.body);

      // Then: streamed server content and generated hydration assets share one response.
      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(html).toContain('Catalog item sku-42');
      expect(html).toContain('Preview mode');
      expect(html).toContain('Loading recommendations');
      expect(html).toContain('Recommended for sku-42');
      expect(html).toContain('src="/assets/entry-client.js"');
      expect(html).toContain('href="/assets/example.css"');
      expect(html).toContain('Current path: /products/sku-42');
      expect(html).toContain('Current preview: true');
      expect(html).toContain('Current URL: /products/sku-42?preview=true');
      expect(html).toContain('Current hash: unset');
      expect(html).toContain('href="/products/sku-84?preview=false"');
    });
  });

  it('negotiates the HTTP-matched page as a versioned browser destination', async () => {
    // Given: a page routed by HTTP with a build-bound destination module.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the client explicitly asks for the navigation representation.
      const response = await app.request('GET', '/products/sku-42')
        .query('preview', 'true')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2')
        .send();

      // Then: the selected route's URL and params, not a browser matcher, identify the destination.
      expect(response.status).toBe(200);
      expect(response.headers['Content-Type']).toBe('application/vnd.fluo.react-navigation+json;v=2');
      expect(response.headers.Vary).toContain('Accept');
      expect(response.body).toEqual({
        version: 2,
        buildId: assets.manifest.buildId,
        url: '/products/sku-42?preview=true',
        params: { sku: 'sku-42' },
        destination: {
          module: './navigation-product.ts',
          props: { preview: true, productName: 'Catalog item sku-42', sku: 'sku-42' },
        },
        metadata: {
          title: 'Catalog item sku-42',
          meta: [
            { name: 'description', content: 'Product sku-42' },
            { property: 'og:title', content: 'Product sku-42' },
          ],
          links: [{ rel: 'canonical', href: '/products/sku-42?preview=true' }],
        },
      });
    });
  });

  it('grants anonymous public prefetch but retains private navigation for restricted fixtures', async () => {
    // Given: a real HTTP dispatcher and a build-mapped destination.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the browser negotiates an explicitly public page and restricted pages.
      const publicResponse = await app.request('GET', '/prefetch/public-84')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2').send();
      const cookieResponse = await app.request('GET', '/prefetch/public-84')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2')
        .header('cookie', 'session=alice').send();
      const privateResponse = await app.request('GET', '/prefetch/private')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2').send();

      // Then: only an anonymous, server-declared identity-independent page is reusable.
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.headers['X-Fluo-Navigation-Prefetch']).toBe('public');
      expect(publicResponse.headers['Cache-Control']).toBe('public, max-age=15');
      expect(publicResponse.body).toMatchObject({
        version: 2,
        buildId: assets.manifest.buildId,
        url: '/prefetch/public-84',
        params: { scenario: 'public-84' },
        destination: { module: './navigation-product.ts' },
      });
      expect(cookieResponse.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      expect(cookieResponse.headers['Cache-Control']).toContain('no-store');
      expect(privateResponse.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      expect(privateResponse.headers['Cache-Control']).toContain('no-store');
    });
  });

  it('retains application response restrictions and rejects auth, redirects, and missing pages', async () => {
    // Given: HTTP-owned prefetch fixtures with pre-existing response policy or credentials.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const navigation = (scenario: string) => app.request('GET', `/prefetch/${scenario}`)
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2');

      // When: the same negotiated route runs under each policy.
      const noStore = await navigation('no-store').send();
      const setCookie = await navigation('set-cookie').send();
      const varyCookie = await navigation('vary-cookie').send();
      const authDenied = await navigation('auth').send();
      const authAllowed = await navigation('auth').header('cookie', 'session=alice').send();
      const redirect = await navigation('redirect').send();
      const missing = await navigation('missing').send();

      // Then: none of the denied cases gains the public grant.
      for (const response of [noStore, setCookie, varyCookie, authDenied, authAllowed, redirect, missing]) {
        expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      }
      expect(noStore.headers['Cache-Control']).toContain('no-store');
      expect(setCookie.headers['Set-Cookie']).toContain('prefetch-example=1');
      expect(varyCookie.headers.Vary).toContain('Cookie');
      expect(authDenied.status).toBe(403);
      expect(authAllowed.status).toBe(200);
      expect(redirect.status).toBe(302);
      expect(missing.status).toBe(404);
    });
  });

  it('dispatches admin QR and songs as ordinary documents and approved destinations', async () => {
    // Given: two explicit HTTP routes sharing one client destination module.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());

      // When: each route receives a direct GET and a negotiated browser request.
      for (const [path, heading] of [['/admin/qr', 'Admin QR'], ['/admin/songs', 'Admin songs']]) {
        const document = await app.request('GET', path).send();
        const navigation = await app.request('GET', path)
          .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2').send();

        // Then: only HTTP chooses a page and produces the confirmed URL and module.
        expect(document.status, JSON.stringify(document.body)).toBe(200);
        expect(readHtml(document.body)).toContain(heading);
        expect(navigation.body).toEqual({
          version: 2,
          buildId: assets.manifest.buildId,
          url: path,
          params: {},
          destination: { module: './navigation-admin.ts', props: { page: path.split('/').at(-1) } },
          metadata: path === '/admin/qr'
            ? {
              title: 'Admin QR',
              meta: [{ name: 'description', content: 'QR access' }],
              links: [{ rel: 'canonical', href: '/admin/qr' }],
            }
            : {
              title: 'Admin songs',
              meta: [{ name: 'description', content: 'Songs catalog' }],
            },
        });
      }
    });
  });

  it('keeps path and query validation on the server-owned DTO boundary', async () => {
    // Given: a fluo React route whose path and query fields have validation rules.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: navigation reaches the server with invalid path and query values.
      const response = await app.request('GET', '/products/x')
        .query('preview', 'maybe')
        .header('Accept', 'application/vnd.fluo.react-navigation+json;v=2')
        .send();

      // Then: HTTP DTO validation rejects the request before React rendering.
      expect(response.status).toBe(400);
      expect(response.headers['Content-Type']).not.toBe('application/vnd.fluo.react-navigation+json;v=2');
    });
  });

  it('protects native form mutations with the ordinary HTTP guard pipeline', async () => {
    // Given: a rendered React product whose mutation route requires application authorization.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: an unauthenticated native-form payload reaches the ordinary POST route.
      const response = await app.request('POST', '/products/sku-42').body({ name: 'Renamed catalog item' }).send();

      // Then: the route guard rejects the mutation before application state changes.
      expect(response.status).toBe(403);
    });
  });

  it('returns a safe 400 representation for invalid native form input', async () => {
    // Given: an authorized request to the ordinary HTTP mutation route.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });

    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the submitted product name violates the request DTO contract.
      const response = await app
        .request('POST', '/products/sku-42')
        .header('x-example-user', 'catalog-editor')
        .header('x-request-id', 'native-form-invalid')
        .body({ name: 'x' })
        .send();

      // Then: the canonical validation envelope exposes safe field-level details.
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'BAD_REQUEST',
          details: [
            {
              code: 'PRODUCT_NAME_TOO_SHORT',
              field: 'name',
              message: 'Product name must contain at least 3 characters.',
              source: 'body',
            },
          ],
          message: 'Validation failed.',
          meta: undefined,
          requestId: 'native-form-invalid',
          status: 400,
        },
      });
    });
  });

  it('redirects a successful native form mutation with 303 See Other', async () => {
    // Given: an authorized editor submitting a valid product mutation.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      // When: the ordinary POST handler accepts the bound request DTO.
      const response = await app
        .request('POST', '/products/sku-42')
        .header('x-example-user', 'catalog-editor')
        .body({ name: 'Renamed catalog item' })
        .send();

      // Then: the handler sends the browser back through the ordinary GET dispatcher.
      expect(response.status).toBe(303);
      expect(response.headers.location).toBe('/products/sku-42?updated=true');
      expect(response.headers['x-example-middleware']).toBe('react-native-form');
      expect(response.headers['x-example-interceptor']).toBe('request-scoped');
    });
  });

  it('reapproves changed current-page data through the real HTTP dispatcher', async () => {
    // Given: a DTO-bound page and an authorized external mutation on the same app.
    const AppModule = createReactViteExampleModule({
      clientDirectory: new URL('../dist/client/', import.meta.url),
      manifest: VITE_MANIFEST,
    });
    const app = await Test.createApp({ rootModule: AppModule });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const accept = 'application/vnd.fluo.react-navigation+json;v=2';
      const before = await app.request('GET', '/products/sku-42').query('preview', 'true')
        .header('Accept', accept).send();

      // When: a native POST updates the backing name, then the same negotiated GET runs again.
      const mutation = await app.request('POST', '/products/sku-42')
        .header('x-example-user', 'catalog-editor').body({ name: 'Fresh catalog name' }).send();
      const after = await app.request('GET', '/products/sku-42').query('preview', 'true')
        .header('Accept', accept).send();
      const invalid = await app.request('GET', '/products/x').query('preview', 'true')
        .header('Accept', accept).send();
      const document = await app.request('GET', '/products/sku-42').query('preview', 'true').send();

      // Then: each request passes HTTP DTO, guard, interceptor and a new request scope.
      expect(before.body).toMatchObject({
        destination: { props: { productName: 'Catalog item sku-42' } },
      });
      expect(mutation.status).toBe(303);
      expect(after.body).toMatchObject({
        params: { sku: 'sku-42' },
        destination: { props: { productName: 'Fresh catalog name' } },
      });
      expect(after.headers['x-example-read-guard']).toBe('approved');
      expect(after.headers['x-example-interceptor']).toBe('request-scoped');
      expect(after.headers['x-example-request-scope']).not.toBe(before.headers['x-example-request-scope']);
      expect(invalid.status).toBe(400);
      expect(document.status).toBe(200);
      expect(document.headers['Content-Type']).toContain('text/html');
      expect(readHtml(document.body)).toContain('Fresh catalog name');
    });
  });
});
