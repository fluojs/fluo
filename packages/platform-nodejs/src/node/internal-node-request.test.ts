import { describe, expect, it, vi } from 'vitest';

import { createDeferredFrameworkRequestShell } from './internal-node-request.js';

describe('createDeferredFrameworkRequestShell', () => {
  it('snapshots Node transport metadata for every Node-backed adapter', () => {
    const request = createDeferredFrameworkRequestShell({
      path: '/connection',
      raw: {
        socket: {
          encrypted: true,
          remoteAddress: '2001:db8::10',
        },
      },
      signal: new AbortController().signal,
      url: '/connection',
    });

    expect(request.connection).toEqual({
      protocol: 'https',
      remoteAddress: '2001:db8::10',
    });
    expect(Object.isFrozen(request.connection)).toBe(true);
  });

  it('leaves transport metadata absent when a raw request has no peer address', () => {
    const request = createDeferredFrameworkRequestShell({
      path: '/connection',
      raw: {},
      signal: new AbortController().signal,
      url: '/connection',
    });

    expect(request.connection).toBeUndefined();
  });

  it('createDeferredFrameworkRequestShell: unread metadata -> leaves all factories lazy', () => {
    const headersFactory = vi.fn(() => ({ cookie: 'mode=first' }));
    const queryFactory = vi.fn(() => ({ mode: 'first' }));
    const signal = vi.fn(() => new AbortController().signal);

    createDeferredFrameworkRequestShell({
      headersFactory, queryFactory, signal, path: '/', raw: {}, url: '/',
    });

    expect(headersFactory).not.toHaveBeenCalled();
    expect(queryFactory).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  });

  it('createDeferredFrameworkRequestShell: repeated metadata access -> preserves cached values and identity', () => {
    const headers = { cookie: 'mode=first' };
    const query = { tags: ['first'] };
    const headersFactory = vi.fn(() => headers);
    const queryFactory = vi.fn(() => query);
    const request = createDeferredFrameworkRequestShell({
      headersFactory, queryFactory, signal: new AbortController().signal,
      path: '/', raw: {}, url: '/',
    });

    const cookies = request.cookies;
    const resolvedQuery = request.query;
    headers.cookie = 'mode=second';
    query.tags.push('second');

    expect(cookies).toEqual({ mode: 'first' });
    expect(request.cookies).toBe(cookies);
    expect(request.headers).toBe(headers);
    expect(request.query).toBe(resolvedQuery);
    expect(request.query).toEqual({ tags: ['first', 'second'] });
    expect(headersFactory).toHaveBeenCalledTimes(1);
    expect(queryFactory).toHaveBeenCalledTimes(1);
    for (const key of ['cookies', 'headers', 'query']) {
      const descriptor = Object.getOwnPropertyDescriptor(request, key);
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
      expect(typeof descriptor?.get).toBe('function');
    }
  });

  it('createDeferredFrameworkRequestShell: explicit snapshots -> bypasses unnecessary factories', () => {
    const query = {};
    const queryFactory = vi.fn(() => ({ ignored: 'value' }));
    const headersFactory = vi.fn(() => ({ cookie: 'ignored=value' }));
    const request = createDeferredFrameworkRequestShell({
      cookieHeader: 'mode=snapshot', headersFactory, query, queryFactory,
      signal: new AbortController().signal, path: '/', raw: {}, url: '/',
    });

    const cookies = request.cookies;

    expect(cookies).toEqual({ mode: 'snapshot' });
    expect(request.query).toBe(query);
    expect(queryFactory).not.toHaveBeenCalled();
    expect(headersFactory).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(request, 'query')?.value).toBe(query);
  });

  it('createDeferredFrameworkRequestShell: query factory throws once -> retries then caches success', () => {
    const failure = new Error('query failure');
    const query = { mode: 'recovered' };
    const queryFactory = vi.fn(() => query).mockImplementationOnce(() => { throw failure; });
    const request = createDeferredFrameworkRequestShell({
      queryFactory, signal: new AbortController().signal, path: '/', raw: {}, url: '/',
    });

    expect(() => request.query).toThrow(failure);

    expect(request.query).toBe(query);
    expect(request.query).toBe(query);
    expect(queryFactory).toHaveBeenCalledTimes(2);
  });

  it('createDeferredFrameworkRequestShell: cookie header factory throws once -> retries then caches success', () => {
    const failure = new Error('header failure');
    const headersFactory = vi.fn(() => ({ cookie: 'mode=recovered' }))
      .mockImplementationOnce(() => { throw failure; });
    const request = createDeferredFrameworkRequestShell({
      headersFactory, signal: new AbortController().signal, path: '/', raw: {}, url: '/',
    });

    expect(() => request.cookies).toThrow(failure);

    const cookies = request.cookies;
    expect(cookies).toEqual({ mode: 'recovered' });
    expect(request.cookies).toBe(cookies);
    expect(request.headers).toEqual({ cookie: 'mode=recovered' });
    expect(headersFactory).toHaveBeenCalledTimes(2);
  });

  it('createDeferredFrameworkRequestShell: signal callback -> preserves lazy repeated observation', () => {
    const signal = vi.fn(() => new AbortController().signal);
    const request = createDeferredFrameworkRequestShell({ signal, path: '/', raw: {}, url: '/' });
    expect(signal).not.toHaveBeenCalled();

    const first = request.signal;
    const second = request.signal;

    expect(first).not.toBe(second);
    expect(signal).toHaveBeenCalledTimes(2);
  });

  it('createDeferredFrameworkRequestShell: separate requests -> isolates cached metadata', () => {
    const make = (value: string) => createDeferredFrameworkRequestShell({
      headers: { cookie: `mode=${value}` }, queryFactory: () => ({ mode: value }),
      signal: new AbortController().signal, path: '/', raw: {}, url: '/',
    });

    const first = make('first');
    const second = make('second');

    expect(first.cookies).toEqual({ mode: 'first' });
    expect(second.cookies).toEqual({ mode: 'second' });
    expect(first.cookies).not.toBe(second.cookies);
    expect(first.query).not.toBe(second.query);
    expect(first.params).not.toBe(second.params);
  });

  it('createDeferredFrameworkRequestShell: absent metadata factories -> caches empty cookie and query records', () => {
    const request = createDeferredFrameworkRequestShell({
      signal: new AbortController().signal, path: '/', raw: {}, url: '/',
    });

    const cookies = request.cookies;
    const query = request.query;

    expect(cookies).toEqual({});
    expect(query).toEqual({});
    expect(request.cookies).toBe(cookies);
    expect(request.query).toBe(query);
  });
});
