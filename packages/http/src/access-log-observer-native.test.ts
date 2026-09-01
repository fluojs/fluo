import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  type AccessLogEvent,
  type FrameworkRequest,
  type FrameworkResponse,
} from './index.js';
import * as http from './index.js';

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
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

describe('createAccessLogObserver native dispatch', () => {
  it('falls native route dispatch back to the observer-complete lifecycle', async () => {
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

    @Controller('/native-access-log')
    class NativeAccessLogController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const handlerMapping = createHandlerMapping([{ controllerToken: NativeAccessLogController }]);
    const dispatcher = createDispatcher({
      handlerMapping,
      observers: [observer],
      rootContainer: new Container().register(NativeAccessLogController),
    });
    const nativeRequest = createRequest('/native-access-log');
    const nativeMatch = handlerMapping.match(nativeRequest);
    const nativeRouteDispatcher = dispatcher.dispatchNativeRoute;

    if (!nativeMatch || !nativeRouteDispatcher) {
      throw new Error('Expected native route dispatch support.');
    }

    // When
    await dispatcher.dispatch(createRequest('/native-access-log'), createResponse());
    const executedFastPath = await nativeRouteDispatcher(nativeMatch, nativeRequest, createResponse());
    await dispatcher.dispatch(nativeRequest, createResponse());

    // Then
    expect(executedFastPath).toBe(false);
    expect(records.filter((record) => record.event === 'http.access.finish')).toEqual([
      {
        durationMs: 0,
        event: 'http.access.finish',
        matchedRoute: '/native-access-log',
        method: 'GET',
        outcome: 'success',
        path: '/native-access-log',
        status: 200,
      },
      {
        durationMs: 0,
        event: 'http.access.finish',
        matchedRoute: '/native-access-log',
        method: 'GET',
        outcome: 'success',
        path: '/native-access-log',
        status: 200,
      },
    ]);
  });
});
