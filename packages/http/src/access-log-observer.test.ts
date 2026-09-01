import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  assertRequestContext,
  BadRequestException,
  Controller,
  createDispatcher,
  createHandlerMapping,
  createCorrelationMiddleware,
  Get,
  type AccessLogEvent,
  type FrameworkRequest,
  type FrameworkResponse,
} from './index.js';
import * as http from './index.js';

function createRequest(
  path: string,
  options: {
    readonly headers?: FrameworkRequest['headers'];
    readonly isAborted?: FrameworkRequest['isAborted'];
    readonly requestId?: string;
    readonly signal?: AbortSignal;
  } = {},
): FrameworkRequest {
  return {
    body: undefined,
    connection: {
      remoteAddress: '203.0.113.42',
    },
    cookies: {},
    headers: options.headers ?? {},
    isAborted: options.isAborted,
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    requestId: options.requestId,
    signal: options.signal,
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
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

describe('createAccessLogObserver', () => {
  it('uses correlation middleware IDs in coherent start error and finish events', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const observer = http.createAccessLogObserver({
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log-correlation')
    class CorrelationController {
      @Get('/')
      fail() {
        throw new Error('expected correlation failure');
      }
    }

    const dispatcher = createDispatcher({
      appMiddleware: [createCorrelationMiddleware()],
      handlerMapping: createHandlerMapping([{ controllerToken: CorrelationController }]),
      observers: [observer],
      rootContainer: new Container().register(CorrelationController),
    });
    const response = createResponse();

    // When
    await dispatcher.dispatch(createRequest('/access-log-correlation', {
      headers: { 'X-Correlation-Id': 'legacy-correlation-42' },
    }), response);

    // Then
    expect(response.headers['x-request-id']).toBe('legacy-correlation-42');
    expect(records.map((record) => record.requestId)).toEqual([
      'legacy-correlation-42',
      'legacy-correlation-42',
      'legacy-correlation-42',
    ]);
  });

  it('keeps a generated correlation ID coherent across real dispatch error lifecycle events', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const observer = http.createAccessLogObserver({
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log-generated-correlation')
    class GeneratedCorrelationController {
      @Get('/')
      fail() {
        throw new Error('expected generated correlation failure');
      }
    }

    const dispatcher = createDispatcher({
      appMiddleware: [createCorrelationMiddleware()],
      handlerMapping: createHandlerMapping([{ controllerToken: GeneratedCorrelationController }]),
      observers: [observer],
      rootContainer: new Container().register(GeneratedCorrelationController),
    });
    const response = createResponse();

    // When
    await dispatcher.dispatch(createRequest('/access-log-generated-correlation'), response);

    // Then
    expect(records.map((record) => record.event)).toEqual([
      'http.access.start',
      'http.access.error',
      'http.access.finish',
    ]);
    expect(records.map((record) => record.requestId)).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    expect([...new Set(records.map((record) => record.requestId))]).toHaveLength(1);
    expect(response.headers['x-request-id']).toBe(records[0]?.requestId);
  });

  it('emits redacted start and terminal records with monotonic duration and a trusted client', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const timestamps = [100, 117];
    const observer = http.createAccessLogObserver({
      clientIdentity: {},
      clock: () => {
        const timestamp = timestamps.shift();

        if (timestamp === undefined) {
          throw new Error('Unexpected access log clock read.');
        }

        return timestamp;
      },
      headers: {
        allow: ['accept', 'authorization', 'cookie', 'set-cookie', 'x-api-token'],
        redact: ['x-api-token'],
      },
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log')
    class AccessLogController {
      @Get('/:id')
      getValue() {
        assertRequestContext().response.setHeader('Set-Cookie', 'session=top-secret');

        return { ok: true };
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AccessLogController }]),
      observers: [observer],
      rootContainer: new Container().register(AccessLogController),
    });

    // When
    await dispatcher.dispatch(
      createRequest('/access-log/42', {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer secret',
          Cookie: 'session=top-secret',
          'X-Request-Id': 'request-42',
          'X-Api-Token': 'secret-token',
        },
      }),
      createResponse(),
    );

    // Then
    expect(records).toEqual([
      {
        clientAddress: '203.0.113.42',
        event: 'http.access.start',
        method: 'GET',
        path: '/access-log/42',
        requestHeaders: {
          accept: 'application/json',
          authorization: '[REDACTED]',
          cookie: '[REDACTED]',
          'x-api-token': '[REDACTED]',
        },
        requestId: 'request-42',
      },
      {
        clientAddress: '203.0.113.42',
        durationMs: 17,
        event: 'http.access.finish',
        matchedRoute: '/access-log/:id',
        method: 'GET',
        outcome: 'success',
        path: '/access-log/42',
        requestHeaders: {
          accept: 'application/json',
          authorization: '[REDACTED]',
          cookie: '[REDACTED]',
          'x-api-token': '[REDACTED]',
        },
        requestId: 'request-42',
        responseHeaders: {
          'set-cookie': '[REDACTED]',
        },
        status: 200,
      },
    ]);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(Object.isFrozen(records[1])).toBe(true);
    expect(Object.isFrozen(records[1]?.requestHeaders)).toBe(true);
    const finish = records.find((record) => record.event === 'http.access.finish');
    expect(Object.isFrozen(finish?.responseHeaders)).toBe(true);
  });

  it('emits one terminal outcome for handled, unhandled, not-found, and aborted requests', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const observer = http.createAccessLogObserver({
      clock: () => 1,
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log-errors')
    class AccessLogErrorController {
      @Get('/handled')
      handled() {
        throw new BadRequestException('Handled request failure.');
      }

      @Get('/unhandled')
      unhandled() {
        throw new Error('Unhandled request failure.');
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AccessLogErrorController }]),
      observers: [observer],
      rootContainer: new Container().register(AccessLogErrorController),
    });
    const abortController = new AbortController();
    abortController.abort();

    // When
    await dispatcher.dispatch(createRequest('/access-log-errors/handled'), createResponse());
    await dispatcher.dispatch(createRequest('/access-log-errors/unhandled'), createResponse());
    await dispatcher.dispatch(createRequest('/access-log-errors/missing'), createResponse());
    await dispatcher.dispatch(createRequest('/access-log-errors/handled', { signal: abortController.signal }), createResponse());

    // Then
    expect(records.filter((record) => record.event === 'http.access.error')).toEqual([
      {
        errorName: 'BadRequestException',
        event: 'http.access.error',
        matchedRoute: '/access-log-errors/handled',
        method: 'GET',
        path: '/access-log-errors/handled',
      },
      {
        errorName: 'Error',
        event: 'http.access.error',
        matchedRoute: '/access-log-errors/unhandled',
        method: 'GET',
        path: '/access-log-errors/unhandled',
      },
      {
        errorName: 'HandlerNotFoundError',
        event: 'http.access.error',
        method: 'GET',
        path: '/access-log-errors/missing',
      },
    ]);
    expect(records.filter((record) => record.event === 'http.access.finish')).toEqual([
      expect.objectContaining({ outcome: 'handled_error', status: 400 }),
      expect.objectContaining({ outcome: 'unhandled_error', status: 500 }),
      expect.objectContaining({ outcome: 'not_found', status: 404 }),
      expect.objectContaining({ outcome: 'aborted' }),
    ]);
    expect(records.filter((record) => record.event === 'http.access.finish')).toHaveLength(4);
  });

  it('records the final default status for manually committed responses', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const observer = http.createAccessLogObserver({
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log-manual')
    class ManualResponseController {
      @Get('/')
      async sendManually() {
        await assertRequestContext().response.send({ committed: true });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ManualResponseController }]),
      observers: [observer],
      rootContainer: new Container().register(ManualResponseController),
    });

    // When
    await dispatcher.dispatch(createRequest('/access-log-manual'), createResponse());

    // Then
    expect(records).toContainEqual(expect.objectContaining({
      event: 'http.access.finish',
      outcome: 'success',
      status: 200,
    }));
  });

  it('records aborted terminal outcomes for signal and adapter-probe cancellation during dispatch', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const signalAbortController = new AbortController();
    let probeAborted = false;
    const observer = http.createAccessLogObserver({
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log-cancellation')
    class CancellationController {
      @Get('/signal')
      abortSignal() {
        signalAbortController.abort();
        return { ignored: true };
      }

      @Get('/probe')
      abortProbe() {
        probeAborted = true;
        return { ignored: true };
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: CancellationController }]),
      observers: [observer],
      rootContainer: new Container().register(CancellationController),
    });

    // When
    await dispatcher.dispatch(
      createRequest('/access-log-cancellation/signal', { signal: signalAbortController.signal }),
      createResponse(),
    );
    await dispatcher.dispatch(
      createRequest('/access-log-cancellation/probe', { isAborted: () => probeAborted }),
      createResponse(),
    );

    // Then
    expect(records.filter((record) => record.event === 'http.access.error')).toHaveLength(0);
    expect(records.filter((record) => record.event === 'http.access.finish')).toEqual([
      expect.objectContaining({ outcome: 'aborted' }),
      expect.objectContaining({ outcome: 'aborted' }),
    ]);
  });

  it('records thrown undefined as an error outcome', async () => {
    // Given
    const records: AccessLogEvent[] = [];
    const observer = http.createAccessLogObserver({
      sink: {
        emit(record) {
          records.push(record);
        },
      },
    });

    @Controller('/access-log-undefined-error')
    class UndefinedErrorController {
      @Get('/')
      throwUndefined() {
        throw undefined;
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: UndefinedErrorController }]),
      observers: [observer],
      rootContainer: new Container().register(UndefinedErrorController),
    });

    // When
    await dispatcher.dispatch(createRequest('/access-log-undefined-error'), createResponse());

    // Then
    expect(records).toContainEqual(expect.objectContaining({
      errorName: 'UnknownError',
      event: 'http.access.error',
    }));
    expect(records).toContainEqual(expect.objectContaining({
      event: 'http.access.finish',
      outcome: 'unhandled_error',
      status: 500,
    }));
  });

  it('awaits asynchronous sink emission through the terminal lifecycle', async () => {
    // Given
    let finishEmissionSettled = false;
    let releaseFinishEmission: () => void = () => undefined;
    const finishEmission = new Promise<void>((resolve) => {
      releaseFinishEmission = resolve;
    });
    let signalFinishEmission: () => void = () => undefined;
    const finishEmissionStarted = new Promise<void>((resolve) => {
      signalFinishEmission = resolve;
    });
    const observer = http.createAccessLogObserver({
      sink: {
        async emit(record) {
          if (record.event === 'http.access.finish') {
            signalFinishEmission();
            await finishEmission;
            finishEmissionSettled = true;
          }
        },
      },
    });

    @Controller('/access-log-async-sink')
    class AsyncSinkController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: AsyncSinkController }]),
      observers: [observer],
      rootContainer: new Container().register(AsyncSinkController),
    });

    // When
    const dispatch = dispatcher.dispatch(createRequest('/access-log-async-sink'), createResponse());
    await finishEmissionStarted;

    // Then
    expect(finishEmissionSettled).toBe(false);
    releaseFinishEmission();
    await dispatch;
    expect(finishEmissionSettled).toBe(true);
  });

  it('keeps direct identity opt-in and trusts forwarding only through trustProxy', async () => {
    // Given
    const directRecords: AccessLogEvent[] = [];
    const forwardedRecords: AccessLogEvent[] = [];
    const omittedRecords: AccessLogEvent[] = [];
    const createObserver = (records: AccessLogEvent[], clientIdentity?: http.ResolveHttpConnectionOptions) => (
      http.createAccessLogObserver({
        ...(clientIdentity === undefined ? {} : { clientIdentity }),
        sink: {
          emit(record) {
            records.push(record);
          },
        },
      })
    );

    @Controller('/access-log-identity')
    class IdentityController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: IdentityController }]);
    const request = createRequest('/access-log-identity', {
      headers: {
        'X-Forwarded-For': '198.51.100.9',
      },
    });

    // When
    await createDispatcher({
      handlerMapping: mapping,
      observers: [createObserver(omittedRecords)],
      rootContainer: new Container().register(IdentityController),
    }).dispatch(request, createResponse());
    await createDispatcher({
      handlerMapping: mapping,
      observers: [createObserver(directRecords, {})],
      rootContainer: new Container().register(IdentityController),
    }).dispatch(request, createResponse());
    await createDispatcher({
      handlerMapping: mapping,
      observers: [createObserver(forwardedRecords, { trustProxy: 1 })],
      rootContainer: new Container().register(IdentityController),
    }).dispatch(request, createResponse());

    // Then
    expect(omittedRecords).not.toContainEqual(expect.objectContaining({ clientAddress: expect.any(String) }));
    expect(directRecords).toContainEqual(expect.objectContaining({ clientAddress: '203.0.113.42' }));
    expect(forwardedRecords).toContainEqual(expect.objectContaining({ clientAddress: '198.51.100.9' }));
  });
});
