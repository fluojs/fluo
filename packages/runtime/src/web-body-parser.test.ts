import type { BodyParserContext } from '@fluojs/http';
import bodyParserCases from '../../../tooling/testing/body-parser-cases.json';
import { describe, expect, it, vi } from 'vitest';
import { createWebFrameworkRequest, createWebRequestResponseFactory, dispatchWebRequest } from './web.js';

function request(body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request('https://parser.test/posts?draft=1', {
    method: 'POST', body, headers: { 'content-type': 'application/json', ...headers }, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('bounded Web body parser policy', () => {
  it.each(bodyParserCases)('returns exact text for %j with %s without changing metadata', async (text, mime) => {
    const raw = request(text, { 'content-type': mime, 'x-original': 'yes' });
    const factory = createWebRequestResponseFactory({ bodyParser: 'text', rawBody: true });
    const normalized = await factory.createRequest(raw, raw.signal);
    expect(raw.bodyUsed).toBe(false);
    expect(normalized.body).toBeUndefined();
    await factory.materializeRequest?.(normalized);
    expect(normalized.body).toBe(text);
    expect(normalized.rawBody).toEqual(new TextEncoder().encode(text));
    expect(normalized.raw).toBe(raw);
    expect(normalized.headers['content-type']).toBe(mime);
    expect(raw.headers.get('content-type')).toBe(mime);
    expect(raw.headers.get('x-original')).toBe('yes');
    await expect(raw.text()).resolves.toBe(text);
  });

  it('lets a path-specific callback delegate unchanged MIME behavior to the default parser', async () => {
    const bodyParser = (text: string, context: BodyParserContext) =>
      context.path === '/posts' ? text : context.parseDefault();
    for (const [path, body, expected] of [
      ['/posts', '{', '{'], ['/other', '{"ok":true}', { ok: true }],
    ] as const) {
      const raw = new Request(`https://parser.test${path}`, {
        method: 'POST', body, headers: { 'content-type': 'application/json' },
      });
      const normalized = await createWebFrameworkRequest(raw, raw.signal, undefined, 100, false, bodyParser);
      expect(normalized.body).toEqual(expected);
    }
    const malformed = new Request('https://parser.test/other', {
      method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
    });
    await expect(createWebFrameworkRequest(malformed, malformed.signal, undefined, 100, false, bodyParser))
      .rejects.toMatchObject({ status: 400 });
  });

  it.each([false, 'json-or-null', {}, 1, null])('rejects invalid JavaScript parser option %j during setup', (bodyParser) => {
    expect(() => Reflect.apply(createWebRequestResponseFactory, undefined, [{ bodyParser }])).toThrow(TypeError);
  });

  it('keeps absent bodies undefined and does not call a custom parser', async () => {
    const bodyParser = vi.fn(() => 'unexpected');
    const factory = createWebRequestResponseFactory({ bodyParser });
    const raw = request();
    const normalized = await factory.createRequest(raw, raw.signal);
    await factory.materializeRequest?.(normalized);
    expect(normalized.body).toBeUndefined();
    expect(bodyParser).not.toHaveBeenCalled();
  });

  it('invokes an async custom parser once with creation-time metadata, including limits', async () => {
    const bodyParser = vi.fn(async (text: string, context: BodyParserContext) => ({ text, path: context.path }));
    const raw = request('abc', { 'content-length': '3' });
    const factory = createWebRequestResponseFactory({ bodyParser, maxBodySize: 3, rawBody: true });
    const normalized = await factory.createRequest(raw, raw.signal);
    expect(bodyParser).not.toHaveBeenCalled();
    raw.headers.set('content-type', 'text/plain');
    raw.headers.set('content-length', '999');
    await Promise.all([factory.materializeRequest?.(normalized), factory.materializeRequest?.(normalized)]);
    await factory.materializeRequest?.(normalized);
    expect(bodyParser).toHaveBeenCalledTimes(1);
    expect(bodyParser).toHaveBeenCalledWith('abc', expect.objectContaining({
      contentType: 'application/json', path: '/posts', method: 'POST', signal: raw.signal,
      headers: expect.objectContaining({ 'content-length': '3' }),
    }));
    expect(normalized.body).toEqual({ text: 'abc', path: '/posts' });
    expect(normalized.rawBody).toEqual(new TextEncoder().encode('abc'));
  });

  it.each(['text', vi.fn(() => 'unreachable')] as const)('enforces UTF-8 bytes before %s parsing', async (bodyParser) => {
    const response = await dispatchWebRequest({
      bodyParser, maxBodySize: 2, request: request('한'),
      dispatcher: { dispatch: vi.fn(() => { throw new Error('must not dispatch'); }) },
    });
    expect(response.status).toBe(413);
    if (typeof bodyParser === 'function') expect(bodyParser).not.toHaveBeenCalled();
  });

  it('rejects an oversized snapshotted content length before consuming bytes', async () => {
    const raw = request('a', { 'content-length': '4' });
    const factory = createWebRequestResponseFactory({ bodyParser: 'text', maxBodySize: 3 });
    const normalized = await factory.createRequest(raw, raw.signal);
    raw.headers.delete('content-length');
    await expect(factory.materializeRequest?.(normalized)).rejects.toMatchObject({ status: 413 });
    expect(raw.bodyUsed).toBe(false);
  });

  it('cancels a pending opt-in read on the framework signal without invoking the parser', async () => {
    let resolveReading!: () => void;
    const reading = new Promise<void>((resolve) => { resolveReading = resolve; });
    let resolveCancelled!: (reason: unknown) => void;
    const cancelled = new Promise<unknown>((resolve) => { resolveCancelled = resolve; });
    const abort = new AbortController();
    const raw = request(new ReadableStream<Uint8Array>({
      pull() { resolveReading(); }, cancel(reason) { resolveCancelled(reason); },
    }, { highWaterMark: 0 }));
    const bodyParser = vi.fn(() => 'unexpected');
    const factory = createWebRequestResponseFactory({ bodyParser, consumeOriginalBody: true });
    const normalized = await factory.createRequest(raw, abort.signal);
    const reason = new Error('cancel parser');
    const rejected = expect(factory.materializeRequest?.(normalized)).rejects.toBe(reason);
    await reading;
    abort.abort(reason);
    await rejected;
    await expect(cancelled).resolves.toBe(reason);
    expect(bodyParser).not.toHaveBeenCalled();
  }, 2_000);

  it('rejects a pre-aborted opt-in body before reading or parsing it', async () => {
    const abort = new AbortController();
    const reason = new Error('already aborted');
    abort.abort(reason);
    const bodyParser = vi.fn(() => 'unexpected');
    const factory = createWebRequestResponseFactory({ bodyParser, consumeOriginalBody: true });
    const raw = request('abc');
    const normalized = await factory.createRequest(raw, abort.signal);
    await expect(factory.materializeRequest?.(normalized)).rejects.toBe(reason);
    expect(raw.bodyUsed).toBe(false);
    expect(bodyParser).not.toHaveBeenCalled();
  });

  it('does not assign a custom async result after cancellation', async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const abort = new AbortController();
    const bodyParser = async (_text: string, { signal }: BodyParserContext) => {
      signal.addEventListener('abort', release, { once: true });
      started();
      try { await gate; return 'must not assign'; }
      finally { signal.removeEventListener('abort', release); }
    };
    const factory = createWebRequestResponseFactory({ bodyParser, consumeOriginalBody: true });
    const raw = request('abc');
    const normalized = await factory.createRequest(raw, abort.signal);
    const reason = new Error('cancel callback');
    const rejected = expect(factory.materializeRequest?.(normalized)).rejects.toBe(reason);
    await entered;
    abort.abort(reason);
    await rejected;
    expect(normalized.body).toBeUndefined();
  }, 2_000);

  it('memoizes parser failures instead of consuming again', async () => {
    const failure = new Error('custom parser failure');
    const bodyParser = vi.fn(() => { throw failure; });
    const factory = createWebRequestResponseFactory({ bodyParser, consumeOriginalBody: true });
    const raw = request('value');
    const normalized = await factory.createRequest(raw, raw.signal);
    await expect(factory.materializeRequest?.(normalized)).rejects.toBe(failure);
    await expect(factory.materializeRequest?.(normalized)).rejects.toBe(failure);
    expect(bodyParser).toHaveBeenCalledTimes(1);
    await expect(raw.text()).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects an already consumed native body without invoking the parser', async () => {
    const raw = request('value');
    await raw.text();
    const bodyParser = vi.fn(() => 'unexpected');
    const factory = createWebRequestResponseFactory({ bodyParser, consumeOriginalBody: true });
    const normalized = await factory.createRequest(raw, raw.signal);
    await expect(factory.materializeRequest?.(normalized)).rejects.toBeInstanceOf(TypeError);
    expect(bodyParser).not.toHaveBeenCalled();
  });

  it('does not replace multipart parsing or capture multipart rawBody', async () => {
    const form = new FormData();
    form.set('title', 'post');
    const raw = new Request('https://parser.test/posts', { method: 'POST', body: form });
    const bodyParser = vi.fn(() => 'unexpected');
    const factory = createWebRequestResponseFactory({ bodyParser, rawBody: true });
    const normalized = await factory.createRequest(raw, raw.signal);
    await factory.materializeRequest?.(normalized);
    expect(normalized.body).toEqual({ title: 'post' });
    expect(normalized.rawBody).toBeUndefined();
    expect(bodyParser).not.toHaveBeenCalled();
  });
});
