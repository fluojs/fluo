import { Container } from '@fluojs/di';
import {
  createRequestContext,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
} from '@fluojs/http';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type ReactReadableStreamRenderer, renderReactResponse } from './render.js';
import { createReactServerEntry } from './server-entry.js';

const TEXT_ENCODER = new TextEncoder();

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/dashboard',
    query: {},
    raw: {},
    url: '/dashboard',
  };
}

function createResponse(onWrite: () => void): FrameworkResponse {
  let closed = false;
  const stream: FrameworkResponseStream = {
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
    waitForDrain() {
      return Promise.resolve();
    },
    write() {
      onWrite();
      return true;
    },
  };

  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    stream,
  };
}

function createUnfinishedSource(cancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    cancel,
    pull(controller) {
      controller.enqueue(TEXT_ENCODER.encode('<main>partial</main>'));
    },
  });
}

describe('renderReactResponse stream lifecycle', () => {
  it('cancels the unfinished reader once and releases its lock when the response sink closes early', async () => {
    // Given: an unfinished React stream and a response sink that closes after its first write.
    const cancel = vi.fn();
    const source = createUnfinishedSource(cancel);
    let closeSink = (): void => {};
    const response = createResponse(() => closeSink());
    closeSink = () => {
      response.stream?.close();
    };
    const context = createRequestContext({
      container: new Container(),
      metadata: {},
      request: createRequest(),
      response,
    });
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => source);

    // When: rendering observes that the committed response sink closed before the source completed.
    await renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard')),
      context,
      { renderToReadableStream },
    );

    // Then: source work is cancelled exactly once and no reader lock remains held.
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(source.locked).toBe(false);
  });

  it('preserves a response write failure while cancelling the unfinished reader once and releasing its lock', async () => {
    // Given: an unfinished React stream and a response sink whose write throws.
    const cancel = vi.fn();
    const source = createUnfinishedSource(cancel);
    const writeFailure = new Error('response write failed');
    const response = createResponse(() => {
      throw writeFailure;
    });
    const context = createRequestContext({
      container: new Container(),
      metadata: {},
      request: createRequest(),
      response,
    });
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => source);

    // When: rendering writes the first source chunk to the failed sink.
    const render = renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard')),
      context,
      { renderToReadableStream },
    );

    // Then: the original sink failure remains observable after exactly-once reader cleanup.
    await expect(render).rejects.toBe(writeFailure);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(source.locked).toBe(false);
  });
});
