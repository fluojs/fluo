import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  assertRequestContext,
  BadRequestException,
  Controller,
  createDispatcher,
  createHandlerMapping,
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
          'X-Api-Token': 'secret-token',
        },
        requestId: 'request-42',
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
});
