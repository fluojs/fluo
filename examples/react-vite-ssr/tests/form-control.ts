import { HttpFormRejection, InternalServerErrorException } from '@fluojs/http';
import type { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import type { CatalogControl, CatalogObservation } from '../src/catalog';

type Server = Parameters<NonNullable<NonNullable<Parameters<typeof FastifyHttpApplicationAdapter.create>[0]>['configureFastify']>>[0];
function gate<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized gate'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

/** Fault injection is installed only in the explicit production test entry, never the normal app. */
export class FormControl {
  readonly events: CatalogObservation[] = [];
  readonly bodies: unknown[] = [];
  readonly uploads: { contentType: string; bytes: string }[] = [];
  requests = 0;
  private mode = '';
  private scope: string | undefined;
  private started = gate<unknown>();
  private release = gate<void>();
  private cleaned = gate<void>();
  private consumed = false;
  private readonly background = new Map<string, {
    readonly started: ReturnType<typeof gate<unknown>>;
    readonly release: ReturnType<typeof gate<void>>;
    readonly cleaned: ReturnType<typeof gate<void>>;
    readonly phase: 'handler' | 'commit';
    readonly fail: boolean;
    scope?: string;
  }>();

  readonly observe: CatalogControl = async (event, context) => {
    this.events.push(event);
    for (const entry of this.background.values()) {
      if (event.phase === 'cleanup' && entry.scope === event.scope) entry.cleaned.resolve();
    }
    const key = `${event.method}:${event.path}:${event.name ?? ''}`;
    const held = this.background.get(key);
    if (held !== undefined && held.scope === undefined && event.phase === held.phase) {
      held.scope = event.scope;
      held.started.resolve(event);
      await held.release.promise;
      if (held.fail) throw new InternalServerErrorException('Injected independent background failure.');
    }
    if (event.phase === 'guard') {
      const body = context.request.body;
      this.bodies.push({
        scope: event.scope, accept: context.request.headers.accept,
        contentType: context.request.headers['content-type'],
        cookiePresent: typeof context.request.headers.cookie === 'string',
        bodyKeys: typeof body === 'object' && body !== null ? Object.keys(body) : [],
        ...(typeof body !== 'object' || body === null ? {} : {
          name: Reflect.get(body, 'display_name'), tag: Reflect.get(body, 'tag'),
          intent: Reflect.get(body, 'intent'), csrfPresent: typeof Reflect.get(body, 'csrf') === 'string',
        }),
      });
    }
    if (event.phase === 'cleanup' && event.scope === this.scope) this.cleaned.resolve();
    if (this.consumed || event.method !== 'POST') return;
    if (this.mode === 'form-errors' && event.phase === 'handler') {
      this.consumed = true;
      throw HttpFormRejection.create({ fieldErrors: {}, formErrors: ['The product is reserved.'] });
    }
    if (this.mode === 'after500' && event.phase === 'commit') {
      this.consumed = true;
      throw new InternalServerErrorException('Injected failure after persistence.');
    }
    if (this.mode === 'hold-before' && event.phase === 'handler'
      || this.mode === 'hold-after' && event.phase === 'commit') {
      this.consumed = true;
      this.scope = event.scope;
      this.started.resolve(event);
      await this.release.promise;
    }
  };

  install(server: Server): void {
    server.post('/__background/arm', async (request) => {
      const body: unknown = request.body;
      if (typeof body !== 'object' || body === null) throw new TypeError('Missing barrier');
      const key: unknown = Reflect.get(body, 'key');
      const phase: unknown = Reflect.get(body, 'phase');
      if (typeof key !== 'string' || phase !== 'handler' && phase !== 'commit') throw new TypeError('Invalid barrier');
      this.background.set(key, { started: gate<unknown>(), release: gate<void>(), cleaned: gate<void>(),
        phase, fail: Reflect.get(body, 'fail') === true });
      return { key };
    });
    server.get<{ Querystring: { key: string } }>('/__background/started', async (request) => {
      const entry = this.background.get(request.query.key);
      if (entry === undefined) throw new TypeError('Missing barrier');
      return entry.started.promise;
    });
    server.get<{ Querystring: { key: string } }>('/__background/cleaned', async (request) => {
      const entry = this.background.get(request.query.key);
      if (entry === undefined) throw new TypeError('Missing barrier');
      return entry.cleaned.promise;
    });
    server.post('/__background/release', async (request) => {
      const body: unknown = request.body;
      const keys: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'keys') : undefined;
      if (!Array.isArray(keys) || !keys.every((key: unknown) => typeof key === 'string')) throw new TypeError('Invalid release keys');
      for (const key of keys) this.background.get(key)?.release.resolve();
      return { released: keys };
    });
    server.post('/__forms/arm', async (request) => {
      const body: unknown = request.body;
      const mode: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'mode') : undefined;
      if (typeof mode !== 'string') throw new TypeError('A mode is required.');
      this.mode = mode;
      this.scope = undefined;
      this.consumed = false;
      this.started = gate<unknown>();
      this.release = gate<void>();
      this.cleaned = gate<void>();
      return { requests: this.requests, commits: this.events.filter((event) => event.phase === 'commit').length };
    });
    server.get('/__forms/started', async () => this.started.promise);
    server.get('/__forms/cleaned', async () => this.cleaned.promise);
    server.post('/__forms/release', async () => {
      this.release.resolve();
      return { released: true };
    });
    server.get('/__forms/state', async () => ({
      requests: this.requests, commits: this.events.filter((event) => event.phase === 'commit').length,
      events: this.events, bodies: this.bodies, uploads: this.uploads,
    }));
    server.addHook('onRequest', async (request) => {
      if (request.method === 'POST' && request.url.startsWith('/catalog/')) this.requests++;
      const contentType = request.headers['content-type'] ?? '';
      if (contentType.startsWith('multipart/form-data')) {
        const chunks: Buffer[] = [];
        request.raw.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        request.raw.pause();
        request.raw.once('end', () => this.uploads.push({
          contentType, bytes: Buffer.concat(chunks).toString('utf8'),
        }));
      }
    });
    server.addHook('preHandler', async (request, reply) => {
      if (request.method !== 'POST' || !request.url.startsWith('/catalog/')) return;
      if (this.mode === 'before503' && !this.consumed) {
        this.consumed = true;
        return reply.code(503).send('Unavailable before dispatcher entry.');
      }
      if (this.mode === 'before-drop' && !this.consumed) {
        this.consumed = true;
        reply.hijack();
        reply.raw.writeHead(200, { 'Content-Type': 'application/vnd.fluo.form+json;v=1', 'Transfer-Encoding': 'chunked' });
        await new Promise<void>((resolve) => reply.raw.write('{"version":1', () => resolve()));
        this.started.resolve({ phase: 'before-handler' });
        await this.release.promise;
        reply.raw.destroy();
        return reply;
      }
    });
    server.addHook('onSend', async (request, reply, payload) => {
      const post = request.method === 'POST' && request.url.startsWith('/catalog/');
      const navigation = request.method === 'GET' && request.url.startsWith('/catalog/')
        && String(reply.getHeader('Content-Type')).includes('react-navigation');
      if (this.consumed || !post && !navigation) return payload;
      if (post && (this.mode === 'redirect303' || this.mode === 'redirect307')) {
        this.consumed = true;
        reply.code(this.mode === 'redirect303' ? 303 : 307).header('Location', '/catalog/login');
        return '';
      }
      if (post && this.mode === 'bad-media') {
        this.consumed = true;
        reply.header('Content-Type', 'text/html');
        return '<main>Unexpected document</main>';
      }
      if (post && this.mode === 'bad-schema') {
        this.consumed = true;
        return '{"version":1,"outcome":"saved"}';
      }
      if (typeof payload !== 'string') return payload;
      if (post && (this.mode === 'unsafe' || this.mode === 'bad-version')) {
        this.consumed = true;
        const value: unknown = JSON.parse(payload);
        if (typeof value !== 'object' || value === null) throw new TypeError('Expected form protocol.');
        Reflect.set(value, this.mode === 'unsafe' ? 'destination' : 'version',
          this.mode === 'unsafe' ? 'https://outside.invalid/catalog' : 99);
        return JSON.stringify(value);
      }
      if (navigation && (this.mode === 'incompatible' || this.mode === 'import')) {
        this.consumed = true;
        const value: unknown = JSON.parse(payload);
        if (typeof value !== 'object' || value === null) throw new TypeError('Expected navigation protocol.');
        if (this.mode === 'incompatible') Reflect.set(value, 'buildId', 'incompatible-test-build');
        else {
          const destination: unknown = Reflect.get(value, 'destination');
          if (typeof destination !== 'object' || destination === null) throw new TypeError('Missing destination.');
          Reflect.set(destination, 'module', './navigation-import-failure.ts');
        }
        return JSON.stringify(value);
      }
      if (post && (this.mode === 'body-late' || this.mode === 'drop-after') || navigation && this.mode === 'hold-read') {
        this.consumed = true;
        this.scope = String(reply.getHeader('X-Catalog-Scope'));
        const headers = Object.entries(reply.getHeaders()).flatMap(([name, value]) =>
          name === 'content-length' || value === undefined ? []
            : Array.isArray(value) ? value.flatMap((entry) => [name, entry]) : [name, String(value)]);
        reply.hijack();
        reply.raw.writeHead(reply.statusCode, [...headers, 'Transfer-Encoding', 'chunked']);
        await new Promise<void>((resolve) => reply.raw.write(payload.slice(0, 12), () => resolve()));
        this.started.resolve({ phase: 'body', scope: this.scope });
        await this.release.promise;
        if (this.mode === 'drop-after') reply.raw.destroy();
        else reply.raw.end(payload.slice(12));
        return payload;
      }
      return payload;
    });
  }
}
