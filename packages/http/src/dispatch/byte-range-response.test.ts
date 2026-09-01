import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createByteRangeResponse,
  createDispatcher,
  createHandlerMapping,
  Get,
  Head,
  Post,
  Route,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
} from '../index.js';

type RecordedResponse = FrameworkResponse & {
  readonly sentBodies: unknown[];
};

function createRequest(
  headers: FrameworkRequest['headers'] = {},
  method = 'GET',
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method,
    params: {},
    path: '/assets/logo',
    query: {},
    raw: {},
    url: '/assets/logo',
  };
}

function createResponse(): RecordedResponse {
  const sentBodies: unknown[] = [];

  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      sentBodies.push(body);
      this.committed = true;
    },
    sentBodies,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('single byte range response', () => {
  it('writes a satisfiable byte range from a byte representation', async () => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ range: 'bytes=2-4' }), response);

    expect(response.statusCode).toBe(206);
    expect(response.headers['Accept-Ranges']).toBe('bytes');
    expect(response.headers['Content-Range']).toBe('bytes 2-4/6');
    expect(response.headers['Content-Length']).toBe('3');
    expect(response.sentBodies).toEqual([Uint8Array.from([2, 3, 4])]);
  });

  it.each([
    ['absent', undefined, 200, undefined, undefined, Uint8Array.from([0, 1, 2, 3, 4, 5])],
    ['malformed', 'items=2-4', 200, undefined, undefined, Uint8Array.from([0, 1, 2, 3, 4, 5])],
    ['multiple', 'bytes=0-1,3-4', 200, undefined, undefined, Uint8Array.from([0, 1, 2, 3, 4, 5])],
    ['suffix', 'bytes=-2', 206, 'bytes 4-5/6', '2', Uint8Array.from([4, 5])],
    ['open-ended', 'bytes=3-', 206, 'bytes 3-5/6', '3', Uint8Array.from([3, 4, 5])],
  ])('handles a %s range deterministically', async (_label, range, status, contentRange, contentLength, body) => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest(range ? { range } : {}), response);

    expect(response.statusCode).toBe(status);
    expect(response.headers['Accept-Ranges']).toBe(contentRange ? 'bytes' : undefined);
    expect(response.headers['Content-Range']).toBe(contentRange);
    expect(response.headers['Content-Length']).toBe(contentLength);
    expect(response.sentBodies).toEqual([body]);
  });

  it('writes a bodyless 416 response for an unsatisfiable range', async () => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ range: 'bytes=9-12' }), response);

    expect(response.statusCode).toBe(416);
    expect(response.headers['Accept-Ranges']).toBe('bytes');
    expect(response.headers['Content-Range']).toBe('bytes */6');
    expect(response.headers['Content-Length']).toBe('0');
    expect(response.sentBodies).toEqual([undefined]);
  });

  it('uses the complete representation when If-Range does not match', async () => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: { etag: { opaqueValue: 'logo-v1', strength: 'strong' } },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({
      'if-range': '"logo-v2"',
      range: 'bytes=2-4',
    }), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers.ETag).toBe('"logo-v1"');
    expect(response.headers['Content-Range']).toBeUndefined();
    expect(response.sentBodies).toEqual([Uint8Array.from([0, 1, 2, 3, 4, 5])]);
  });

  it.each([
    ['a matching strong entity tag', { 'if-range': '"logo-v1"', range: 'bytes=2-4' }, 206],
    ['a weak entity tag', { 'if-range': 'W/"logo-v1"', range: 'bytes=2-4' }, 200],
    ['a current HTTP date', { 'if-range': 'Fri, 02 Jan 2026 00:00:00 GMT', range: 'bytes=2-4' }, 206],
    ['a stale HTTP date', { 'if-range': 'Thu, 01 Jan 2026 00:00:00 GMT', range: 'bytes=2-4' }, 200],
  ])('applies a range only for %s If-Range validator', async (_label, headers, expectedStatus) => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'logo-v1', strength: 'strong' },
              lastModified: new Date('2026-01-02T00:00:00Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest(headers), response);

    expect(response.statusCode).toBe(expectedStatus);
    expect(response.sentBodies).toEqual([
      expectedStatus === 206
        ? Uint8Array.from([2, 3, 4])
        : Uint8Array.from([0, 1, 2, 3, 4, 5]),
    ]);
  });

  it('runs conditional validation before evaluating a range', async () => {
    let handlerCalls = 0;

    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        handlerCalls += 1;
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: { etag: { opaqueValue: 'logo-v1', strength: 'strong' } },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({
      'if-none-match': '"logo-v1"',
      range: 'bytes=2-4',
    }), response);

    expect(response.statusCode).toBe(304);
    expect(response.headers['Content-Range']).toBeUndefined();
    expect(handlerCalls).toBe(0);
  });

  it('ignores Range for unsafe and custom methods across byte response paths', async () => {
    @Controller('/assets')
    class AssetController {
      @Post('/plain')
      postPlainLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }

      @Post('/stream')
      postStreamLogo() {
        return createByteRangeResponse(Uint8Array.from([0, 1, 2, 3, 4, 5]));
      }

      @Route('PURGE', '/stream')
      purgeStreamLogo() {
        return createByteRangeResponse(Uint8Array.from([0, 1, 2, 3, 4, 5]));
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const rangeHeaders = { range: 'bytes=2-4' };
    const plainResponse = createResponse();
    const postResponse = createResponse();
    const purgeResponse = createResponse();

    await dispatcher.dispatch({
      ...createRequest(rangeHeaders, 'POST'),
      path: '/assets/plain',
      url: '/assets/plain',
    }, plainResponse);
    await dispatcher.dispatch({
      ...createRequest(rangeHeaders, 'POST'),
      path: '/assets/stream',
      url: '/assets/stream',
    }, postResponse);
    await dispatcher.dispatch({
      ...createRequest(rangeHeaders, 'PURGE'),
      path: '/assets/stream',
      url: '/assets/stream',
    }, purgeResponse);

    expect(plainResponse.statusCode).toBe(201);
    expect(plainResponse.headers['Content-Range']).toBeUndefined();
    expect(plainResponse.sentBodies).toEqual([Uint8Array.from([0, 1, 2, 3, 4, 5])]);
    expect(postResponse.statusCode).toBe(201);
    expect(postResponse.headers['Content-Range']).toBeUndefined();
    expect(postResponse.headers['Content-Length']).toBe('6');
    expect(postResponse.sentBodies).toEqual([Uint8Array.from([0, 1, 2, 3, 4, 5])]);
    expect(purgeResponse.statusCode).toBe(200);
    expect(purgeResponse.headers['Content-Range']).toBeUndefined();
    expect(purgeResponse.headers['Content-Length']).toBe('6');
    expect(purgeResponse.sentBodies).toEqual([Uint8Array.from([0, 1, 2, 3, 4, 5])]);
  });

  it.each([
    ['a throwing stream factory', () => {
      throw new Error('stream factory failed');
    }],
    ['an invalid stream factory result', () => {
      const stream = new ReadableStream<Uint8Array>();
      Object.defineProperty(stream, 'getReader', { value: undefined });
      return stream;
    }],
  ])('writes a clean 500 before range framing for %s', async (_label, source) => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return createByteRangeResponse(source, { size: 6 });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ range: 'bytes=2-4' }), response);

    expect(response.statusCode).toBe(500);
    expect(response.headers['Accept-Ranges']).toBeUndefined();
    expect(response.headers['Content-Range']).toBeUndefined();
    expect(response.headers['Content-Length']).toBeUndefined();
  });

  it('writes a clean 500 before range framing when stream writing is unavailable', async () => {
    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return createByteRangeResponse(() => new ReadableStream<Uint8Array>(), { size: 6 });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ range: 'bytes=2-4' }), response);

    expect(response.statusCode).toBe(500);
    expect(response.headers['Accept-Ranges']).toBeUndefined();
    expect(response.headers['Content-Range']).toBeUndefined();
    expect(response.headers['Content-Length']).toBeUndefined();
  });

  it('keeps GET and HEAD range metadata identical without opening the body stream for HEAD', async () => {
    let streamPulls = 0;

    function createStream() {
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          streamPulls += 1;

          if (streamPulls % 2 === 1) {
            controller.enqueue(Uint8Array.from([0, 1, 2]));
            return;
          }

          controller.enqueue(Uint8Array.from([3, 4, 5]));
          controller.close();
        },
      });
    }

    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return createByteRangeResponse(createStream, { size: 6 });
      }

      @Head('/logo')
      headLogo() {
        return createByteRangeResponse(createStream, { size: 6 });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const getResponse = createStreamingResponse();
    const headResponse = createStreamingResponse();

    await dispatcher.dispatch(createRequest({ range: 'bytes=2-4' }), getResponse);
    const pullsAfterGet = streamPulls;
    await dispatcher.dispatch({
      ...createRequest({ range: 'bytes=2-4' }),
      method: 'HEAD',
    }, headResponse);

    expect(getResponse.statusCode).toBe(206);
    expect(getResponse.stream.chunks).toEqual([
      Uint8Array.from([2]),
      Uint8Array.from([3, 4]),
    ]);
    expect(headResponse.statusCode).toBe(getResponse.statusCode);
    expect(headResponse.headers).toEqual(getResponse.headers);
    expect(headResponse.sentBodies).toEqual([undefined]);
    expect(headResponse.stream.chunks).toEqual([]);
    expect(streamPulls).toBe(pullsAfterGet);
  });

  it.each(['request signal', 'response close'] as const)(
    'awaits stream cancellation and releases blocked drain when %s aborts the response',
    async (cancellationSurface) => {
      const abortController = new AbortController();
      const cancellation = createDeferred<void>();
      const cancellationStarted = createDeferred<void>();
      let cancelCalls = 0;

      @Controller('/assets')
      class AssetController {
        @Get('/logo')
        getLogo() {
          return createByteRangeResponse(() => new ReadableStream<Uint8Array>({
            cancel() {
              cancelCalls += 1;
              cancellationStarted.resolve();
              return cancellation.promise;
            },
            start(controller) {
              controller.enqueue(Uint8Array.from([0, 1, 2]));
            },
          }), { size: 6 });
        }
      }

      const dispatcher = createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
        rootContainer: new Container().register(AssetController),
      });
      const response = createStreamingResponse();
      const drain = createBlockedDrain(response);
      const dispatch = dispatcher.dispatch({
        ...createRequest({ range: 'bytes=0-5' }),
        signal: abortController.signal,
      }, response);

      await drain.started.promise;

      if (cancellationSurface === 'request signal') {
        abortController.abort();
      } else {
        drain.close();
      }

      await cancellationStarted.promise;
      cancellation.resolve();
      await expect(dispatch).resolves.toBeUndefined();

      expect(cancelCalls).toBe(1);
      expect(response.stream.chunks).toEqual([Uint8Array.from([0, 1, 2])]);
      expect(response.stream.closed).toBe(true);
    },
  );

  it('absorbs source cancellation rejection after request abort', async () => {
    const abortController = new AbortController();
    const cancellationStarted = createDeferred<void>();
    const cancellationFailure = new Error('source cancellation failed');

    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return createByteRangeResponse(() => new ReadableStream<Uint8Array>({
          cancel() {
            cancellationStarted.resolve();
            return Promise.reject(cancellationFailure);
          },
          start(controller) {
            controller.enqueue(Uint8Array.from([0, 1, 2]));
          },
        }), { size: 6 });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createStreamingResponse();
    const drain = createBlockedDrain(response);
    const dispatch = dispatcher.dispatch({
      ...createRequest({ range: 'bytes=0-5' }),
      signal: abortController.signal,
    }, response);

    await drain.started.promise;
    abortController.abort();
    await cancellationStarted.promise;

    await expect(dispatch).resolves.toBeUndefined();
    expect(response.stream.closed).toBe(true);
  });

  it('cancels a blocked byte stream through isAborted without an AbortSignal', async () => {
    let isAborted = false;
    let cancelCalls = 0;

    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return createByteRangeResponse(() => new ReadableStream<Uint8Array>({
          cancel() {
            cancelCalls += 1;
          },
          start(controller) {
            controller.enqueue(Uint8Array.from([0, 1, 2]));
          },
        }), { size: 6 });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createStreamingResponse();
    const originalWrite = response.stream.write.bind(response.stream);
    response.stream.write = (chunk) => {
      const accepted = originalWrite(chunk);
      isAborted = true;
      return accepted;
    };

    await expect(dispatcher.dispatch({
      ...createRequest({ range: 'bytes=0-5' }),
      isAborted: () => isAborted,
    }, response)).resolves.toBeUndefined();

    expect(cancelCalls).toBe(1);
    expect(response.stream.chunks).toEqual([Uint8Array.from([0, 1, 2])]);
    expect(response.stream.closed).toBe(true);
  });

  it('cancels a stream when the request aborts after the first range chunk', async () => {
    const abortController = new AbortController();
    let cancelCalls = 0;

    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return createByteRangeResponse(() => new ReadableStream<Uint8Array>({
          cancel() {
            cancelCalls += 1;
          },
          pull(controller) {
            controller.enqueue(Uint8Array.from([0, 1, 2]));
          },
        }), { size: 6 });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AssetController }]),
      rootContainer: new Container().register(AssetController),
    });
    const response = createStreamingResponse();
    const originalWrite = response.stream.write.bind(response.stream);
    response.stream.write = (chunk) => {
      const accepted = originalWrite(chunk);
      abortController.abort();
      return accepted;
    };

    await dispatcher.dispatch({
      ...createRequest({ range: 'bytes=0-5' }),
      signal: abortController.signal,
    }, response);

    expect(response.stream.chunks).toEqual([Uint8Array.from([0, 1, 2])]);
    expect(cancelCalls).toBe(1);
    expect(response.sentBodies).toEqual([]);
  });
});

type RecordedStream = FrameworkResponseStream & {
  readonly chunks: Uint8Array[];
};

function createDeferred<T>() {
  let reject: (reason?: unknown) => void = () => {};
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function createStreamingResponse(): RecordedResponse & { readonly stream: RecordedStream } {
  const response = createResponse();
  const chunks: Uint8Array[] = [];
  let closed = false;

  const stream: RecordedStream = {
    get closed() {
      return closed;
    },
    chunks,
    close() {
      closed = true;
    },
    write(chunk) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk));
      return true;
    },
  };

  return { ...response, stream };
}

function createBlockedDrain(response: RecordedResponse & { readonly stream: RecordedStream }) {
  const started = createDeferred<void>();
  const drain = createDeferred<void>();
  const originalWrite = response.stream.write.bind(response.stream);
  let closeListener: (() => void) | undefined;

  response.stream.onClose = (listener) => {
    closeListener = listener;
    return () => {
      closeListener = undefined;
    };
  };
  response.stream.waitForDrain = () => {
    started.resolve();
    return drain.promise;
  };
  response.stream.write = (chunk) => {
    originalWrite(chunk);
    return false;
  };

  return {
    close() {
      closeListener?.();
    },
    started,
  };
}
