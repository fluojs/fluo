import { IncomingMessage } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { Container } from '@fluojs/di';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  type RequestContext,
} from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';

import { FastifyHttpApplicationAdapter } from './adapter.js';

describe('Fastify native execution selection', () => {
  it.each([
    { name: 'request-id precedence', headers: { 'X-Correlation-ID': 'correlation', 'X-Request-ID': ['request', 'second'] }, id: 'request' },
    { name: 'undefined request-id fallback', headers: { 'x-request-id': undefined, 'X-Correlation-ID': ['correlation', 'second'] }, id: 'correlation' },
    { name: 'empty array fallback', headers: { 'X-Request-ID': [], 'X-Correlation-ID': 'correlation' }, id: 'correlation' },
    { name: 'first array value only', headers: { 'X-Request-ID': ['  first  ', 'second'] }, id: 'first' },
    { name: 'duplicate casing insertion order', headers: { 'X-Request-ID': 'first', 'x-request-id': 'second' }, id: 'first' },
    { name: 'undefined duplicate casing', headers: { 'X-Request-ID': undefined, 'x-request-id': 'second' }, id: 'second' },
  ] satisfies { name: string; headers: IncomingHttpHeaders; id: string }[])(
    'native metadata: hook-assigned $name -> preserves snapshot, lookup and memoization',
    async ({ headers, id }) => {
      const effective: IncomingHttpHeaders = { ...headers, 'X-Array': ['one', 'two'], cookie: 'mode=first' };
      @Controller('/metadata')
      class MetadataController {
        @Get('')
        get(_input: undefined, context: RequestContext) {
          const values = effective['X-Array'];
          if (Array.isArray(values)) values.splice(0, 1, 'changed');
          effective.cookie = 'mode=changed';
          const raw = context.request.raw;
          if (!(raw instanceof IncomingMessage)) throw new Error('Expected a native request');
          raw.headers['x-request-id'] = 'late-raw-id';
          const snapshot = context.request.headers;
          const cookies = context.request.cookies;
          const query = context.request.query;
          return { requestId: context.requestId,
            headers: Object.fromEntries(Object.keys(effective).map((key) => [key, snapshot[key]])), cookies, query,
            ownsUndefined: Object.entries(headers).filter(([, value]) => value === undefined).every(([key]) => Object.hasOwn(snapshot, key)),
            stable: snapshot === context.request.headers && cookies === context.request.cookies && query === context.request.query };
        }
      }
      const root = new Container().register(MetadataController);
      const dispatcher = createDispatcher({ rootContainer: root, handlerMapping: createHandlerMapping([{ controllerToken: MetadataController }]) });
      const native = vi.spyOn(dispatcher, 'dispatchNativeRoute');
      const adapter = FastifyHttpApplicationAdapter.create({
        port: 0, configureFastify(app) {
          app.addHook('onRequest', async (request) => { request.headers = effective; });
        },
      });
      await adapter.listen(dispatcher);
      try {
        const response = await fetch(`${adapter.getListenTarget().url}/metadata?tag=one&tag=two`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ requestId: id,
          headers: { ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)), 'X-Array': ['one', 'two'], cookie: 'mode=first' },
          cookies: { mode: 'first' }, query: { tag: ['one', 'two'] }, ownsUndefined: true, stable: true });
        expect(native).toHaveBeenCalledTimes(1);
      } finally {
        await adapter.close();
        await root.dispose();
      }
    },
  );

  it('native metadata: undefined effective IDs -> keeps absent marker and unread headers lazy', async () => {
    @Controller('/absent')
    class AbsentController {
      @Get('')
      get(_input: undefined, context: RequestContext) { return { requestId: context.requestId ?? null }; }
    }
    const root = new Container().register(AbsentController);
    const dispatcher = createDispatcher({ rootContainer: root, handlerMapping: createHandlerMapping([{ controllerToken: AbsentController }]) });
    const native = dispatcher.dispatchNativeRoute?.bind(dispatcher);
    if (!native) throw new Error('Expected native dispatch');
    let reads = -1;
    vi.spyOn(dispatcher, 'dispatchNativeRoute').mockImplementation(async (match, request, response) => {
      const getter = vi.spyOn(request, 'headers', 'get');
      const handled = await native(match, request, response);
      reads = getter.mock.calls.length;
      return handled;
    });
    const adapter = FastifyHttpApplicationAdapter.create({ port: 0, configureFastify(app) {
      app.addHook('onRequest', async (request) => { request.headers = { 'X-Request-ID': undefined, 'x-correlation-id': undefined }; });
    } });
    await adapter.listen(dispatcher);
    try {
      const response = await fetch(`${adapter.getListenTarget().url}/absent`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ requestId: null });
      expect(reads).toBe(0);
    } finally {
      await adapter.close();
      await root.dispose();
    }
  });

  it.each(['x-request-id', 'x-correlation-id', 'X-Request-ID', 'X-Correlation-ID'])('preserves hook-assigned %s in the context', async (header) => {
    // Given
    @Controller('/hook-id')
    class HookController {
      @Get('')
      get(_input: undefined, context: RequestContext) {
        return { requestId: context.requestId };
      }
    }
    const root = new Container().register(HookController);
    const dispatcher = createDispatcher({
      rootContainer: root,
      handlerMapping: createHandlerMapping([{ controllerToken: HookController }]),
    });
    const adapter = FastifyHttpApplicationAdapter.create({
      port: 0,
      configureFastify(app) {
        app.addHook('onRequest', async (request) => {
          request.headers = { [header]: 'hook-id' };
        });
      },
    });
    await adapter.listen(dispatcher);
    try {
      // When
      const response = await fetch(`${adapter.getListenTarget().url}/hook-id`);
      // Then
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ requestId: 'hook-id' });
    } finally {
      await adapter.close();
      await root.dispose();
    }
  });

  it('snapshots effective headers and array values before the handler mutates raw headers', async () => {
    // Given
    @Controller('/snapshot')
    class SnapshotController {
      @Get('')
      get(_input: undefined, context: RequestContext) {
        const raw = context.request.raw;
        if (!(raw instanceof IncomingMessage)) throw new Error('Expected a native request');
        raw.headers['x-example'] = 'mutated';
        const values = raw.headers['x-array'];
        if (Array.isArray(values)) values[0] = 'mutated';
        return {
          value: context.request.headers['x-example'],
          values: context.request.headers['x-array'],
        };
      }
    }
    const root = new Container().register(SnapshotController);
    const dispatcher = createDispatcher({
      rootContainer: root,
      handlerMapping: createHandlerMapping([{ controllerToken: SnapshotController }]),
    });
    const adapter = FastifyHttpApplicationAdapter.create({
      port: 0,
      configureFastify(app) {
        app.addHook('onRequest', async (request) => {
          request.raw.headers['x-example'] = 'original';
          request.raw.headers['x-array'] = ['first', 'second'];
        });
      },
    });
    await adapter.listen(dispatcher);
    try {
      // When
      const response = await fetch(`${adapter.getListenTarget().url}/snapshot`);
      // Then
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ value: 'original', values: ['first', 'second'] });
    } finally {
      await adapter.close();
      await root.dispose();
    }
  });

  it.each(['headers', 'signal'] as const)('keeps unused native %s lazy through a successful dispatch', async (property) => {
    // Given
    @Controller('/lazy')
    class LazyController {
      @Get('')
      get() {
        return { ok: true };
      }
    }
    const root = new Container().register(LazyController);
    const dispatcher = createDispatcher({
      rootContainer: root,
      handlerMapping: createHandlerMapping([{ controllerToken: LazyController }]),
    });
    const nativeDispatch = dispatcher.dispatchNativeRoute;
    if (!nativeDispatch) throw new Error('Expected native dispatch support');
    const dispatch = nativeDispatch.bind(dispatcher);
    let reads: number | undefined;
    vi.spyOn(dispatcher, 'dispatchNativeRoute').mockImplementation(async (match, request, response) => {
      const getter = vi.spyOn(request, property, 'get');
      const handled = await dispatch(match, request, response);
      reads = getter.mock.calls.length;
      return handled;
    });
    const adapter = FastifyHttpApplicationAdapter.create({ port: 0 });
    await adapter.listen(dispatcher);
    try {
      // When
      const response = await fetch(`${adapter.getListenTarget().url}/lazy`);
      // Then
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(reads).toBe(0);
    } finally {
      await adapter.close();
      await root.dispose();
    }
  });

  it('skips the native fast attempt for a known full route without losing middleware', async () => {
    // Given
    @Controller('/full')
    class FullController {
      @Get('/:id')
      get(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id };
      }
    }
    const root = new Container().register(FullController);
    const mapping = createHandlerMapping([{ controllerToken: FullController }]);
    const dispatcher = createDispatcher({
      rootContainer: root,
      handlerMapping: mapping,
      appMiddleware: [{
        async handle(context, next) {
          context.response.setHeader('x-full-path', 'preserved');
          await next();
        },
      }],
    });
    const nativeAttempt = vi.spyOn(dispatcher, 'dispatchNativeRoute');
    const adapter = FastifyHttpApplicationAdapter.create({ port: 0 });
    await adapter.listen(dispatcher);
    try {
      // When
      const response = await fetch(`${adapter.getListenTarget().url}/full/123`);
      // Then
      expect(response.status).toBe(200);
      expect(response.headers.get('x-full-path')).toBe('preserved');
      expect(await response.json()).toEqual({ id: '123' });
      expect(nativeAttempt).not.toHaveBeenCalled();
    } finally {
      await adapter.close();
      await root.dispose();
    }
  });
});
