import { Container } from '@fluojs/di';
import type { FrameworkResponse } from '@fluojs/http';
import * as http from '@fluojs/http';
import { describe, expect, it } from 'vitest';

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    setStatus(code) { this.statusCode = code; this.statusSet = true; },
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.body = body; this.committed = true; },
    redirect(status, location) { this.setStatus(status); this.setHeader('Location', location); },
  };
}

const routes = [
  { factory: http.Get, method: 'GET' },
  { factory: http.Post, method: 'POST' },
  { factory: http.Put, method: 'PUT' },
  { factory: http.Patch, method: 'PATCH' },
  { factory: http.Delete, method: 'DELETE' },
  { factory: http.Options, method: 'OPTIONS' },
  { factory: http.Head, method: 'HEAD' },
  { factory: http.Query, method: 'QUERY' },
  { factory: http.All, method: 'PROPFIND' },
  { factory: () => http.Route('purge'), method: 'PURGE' },
];

describe('default HTTP route dispatch', () => {
  it.each(routes)('dispatches $method at root and controller prefix without a path argument', async ({ factory, method }) => {
    for (const prefix of [undefined, '/cats']) {
      // Given
      @http.Controller(prefix)
      class Cats {
        @factory()
        list() { return { cats: ['Milo'] }; }
      }
      const container = new Container().register(Cats);
      const dispatcher = http.createDispatcher({
        handlerMapping: http.createHandlerMapping([{ controllerToken: Cats }]),
        rootContainer: container,
      });
      const response = createResponse();
      const path = prefix ?? '/';

      try {
        // When
        await dispatcher.dispatch({
          method, path, url: path, raw: {}, headers: {}, cookies: {}, params: {}, query: {},
        }, response);

        // Then
        expect(response.statusCode).toBe(method === 'POST' ? 201 : 200);
        expect(response.body).toEqual(method === 'HEAD' ? undefined : { cats: ['Milo'] });
      } finally {
        await container.dispose();
      }
    }
  });

  it('keeps QUERY method specificity ahead of the ALL wildcard at the default path', async () => {
    // Given
    @http.Controller('/cats')
    class Cats {
      @http.All()
      fallback() { return 'all'; }
      @http.Query()
      search() { return 'query'; }
    }
    const container = new Container().register(Cats);
    const mapping = http.createHandlerMapping([{ controllerToken: Cats }]);
    const dispatcher = http.createDispatcher({ handlerMapping: mapping, rootContainer: container });
    try {
      // When / Then
      expect(mapping.descriptors.map((descriptor) => descriptor.route.method)).toEqual(['ALL', 'QUERY']);
      for (const [method, result] of [['QUERY', 'query'], ['GET', 'all'], ['PURGE', 'all']]) {
        const response = createResponse();
        await dispatcher.dispatch({
          method, path: '/cats', url: '/cats', raw: {}, headers: {}, cookies: {}, params: {}, query: {},
        }, response);
        expect(response.body).toBe(result);
      }
    } finally {
      await container.dispose();
    }
  });

  it('drains a managed Sse() source, encodes frames, and finalizes once', async () => {
    // Given
    const events: string[] = [];
    const frames: string[] = [];
    @http.Controller('/events')
    class Events {
      @http.Sse()
      async *stream() {
        try {
          yield { data: 'ready', event: 'connected' };
          yield { count: 1 };
        } finally {
          events.push('source-finally');
        }
      }
    }
    const container = new Container().register(Events);
    const dispatcher = http.createDispatcher({
      handlerMapping: http.createHandlerMapping([{ controllerToken: Events }]),
      rootContainer: container,
      observers: [{ onRequestFinish() { events.push('finish'); } }],
    });
    const response = createResponse();
    let closed = false;
    response.stream = {
      get closed() { return closed; },
      write(chunk) { frames.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)); return true; },
      close() { closed = true; events.push('close'); },
    };

    try {
      // When
      await dispatcher.dispatch({
        method: 'GET', path: '/events', url: '/events', raw: {}, headers: {}, cookies: {}, params: {}, query: {},
      }, response);

      // Then
      expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
      expect(frames.join('')).toBe('event: connected\ndata: ready\n\ndata: {"count":1}\n\n');
      expect(events).toEqual(['source-finally', 'close', 'finish']);
    } finally {
      await container.dispose();
    }
  });
});
