import type { CatalogObservation } from '../src/catalog';
import type { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';

type Server = Parameters<NonNullable<NonNullable<Parameters<typeof FastifyHttpApplicationAdapter.create>[0]>['configureFastify']>>[0];

function signal() {
  let resolve: () => void = () => { throw new Error('Missing payload barrier'); };
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

/** Test-entry-only accounting; it retains scope IDs only until real request cleanup. */
export class ReliabilityControl {
  private readonly scopes = new Set<string>();
  private readonly idle = new Set<() => void>();
  private commits = 0;
  private cleanups = 0;
  private deployment = false;
  private oversized = false;
  private payload: { scope?: string; used: boolean; started: ReturnType<typeof signal>;
    release: ReturnType<typeof signal>; cleaned: ReturnType<typeof signal> } | undefined;

  observe(event: CatalogObservation): void {
    if (event.phase === 'middleware') this.scopes.add(event.scope);
    if (event.phase === 'commit') this.commits++;
    if (event.phase === 'cleanup') {
      if (this.payload?.scope === event.scope) this.payload.cleaned.resolve();
      this.cleanups++;
      this.scopes.delete(event.scope);
      if (this.scopes.size === 0) for (const signal of this.idle) signal();
    }
  }

  install(server: Server, drainHarness: () => number): void {
    server.post('/__reliability/deploy/arm', async () => {
      this.deployment = true;
      return { armed: true };
    });
    server.post('/__reliability/oversized/arm', async () => {
      this.oversized = true;
      return { armed: true };
    });
    server.post('/__reliability/payload/arm', async () => {
      this.payload = { used: false, started: signal(), release: signal(), cleaned: signal() };
      return { armed: true };
    });
    server.get('/__reliability/payload/started', async () => {
      if (this.payload === undefined) throw new Error('Payload is not armed');
      return this.payload.started.promise;
    });
    server.get('/__reliability/payload/cleaned', async () => {
      if (this.payload === undefined) throw new Error('Payload is not armed');
      return this.payload.cleaned.promise;
    });
    server.post('/__reliability/payload/release', async () => {
      if (this.payload === undefined) throw new Error('Payload is not armed');
      this.payload.release.resolve();
      return { released: true };
    });
    server.addHook('onSend', async (request, reply, body) => {
      if (request.url.startsWith('/prefetch/public-bound-')) {
        reply.header('X-Reliability-Session-Cookie',
          request.headers.cookie?.includes('session=cache-test') ? 'present' : 'absent');
      }
      const deployment = this.deployment && request.url === '/admin/qr';
      const oversized = this.oversized && request.url === '/prefetch/public-cache-1';
      if ((deployment || oversized)
        && request.headers.accept === 'application/vnd.fluo.react-navigation+json;v=2') {
        if (typeof body !== 'string') throw new TypeError('Expected serialized navigation payload');
        const value: unknown = JSON.parse(body);
        if (typeof value !== 'object' || value === null) throw new TypeError('Expected navigation payload');
        if (deployment) {
          this.deployment = false;
          Reflect.set(value, 'buildId', 'obsolete-deployment');
        } else {
          this.oversized = false;
          const destination: unknown = Reflect.get(value, 'destination');
          const props: unknown = typeof destination === 'object' && destination !== null
            ? Reflect.get(destination, 'props') : undefined;
          if (typeof props !== 'object' || props === null) throw new TypeError('Expected destination props');
          Reflect.set(props, 'productName', 'x'.repeat(64 * 1024 + 1));
        }
        reply.removeHeader('Content-Length');
        return JSON.stringify(value);
      }
      const entry = this.payload;
      if (entry === undefined || entry.used || request.url !== '/admin/qr'
        || request.headers.accept !== 'application/vnd.fluo.react-navigation+json;v=2') return body;
      entry.used = true;
      entry.scope = String(reply.getHeader('X-Catalog-Scope'));
      const headers = Object.entries(reply.getHeaders()).flatMap(([name, value]) =>
        name === 'content-length' || value === undefined ? [] : Array.isArray(value)
          ? value.flatMap((item) => [name, item]) : [name, String(value)]);
      reply.hijack();
      reply.raw.writeHead(reply.statusCode, [...headers, 'Transfer-Encoding', 'chunked']);
      // Actual invalid wire bytes are sent before cancellation, not a skipped mock reply.
      await new Promise<void>((resolve) => reply.raw.write('{"version":', () => resolve()));
      entry.started.resolve();
      await entry.release.promise;
      reply.raw.end('99}');
      return body;
    });
    server.get('/__reliability/checkpoint', async () => {
      if (this.scopes.size !== 0) {
        await new Promise<void>((resolve, reject) => {
          const finish = () => { clearTimeout(deadline); this.idle.delete(finish); resolve(); };
          const deadline = setTimeout(() => {
            this.idle.delete(finish);
            reject(new Error('Real request scopes did not clean up'));
          }, 10_000);
          this.idle.add(finish);
        });
      }
      const harnessEntriesDrained = drainHarness();
      this.payload = undefined;
      return {
        requestScopes: this.scopes.size, cleanupSubscriptions: this.idle.size,
        commits: this.commits, cleanups: this.cleanups, harnessEntriesDrained,
        server: { pid: process.pid, ...process.memoryUsage(), gc: 'not-forced' },
      };
    });
  }
}
