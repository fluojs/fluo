import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  UseGuards,
} from '../index.js';

function createRequest(headers: FrameworkRequest['headers'] = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path: '/validators/resource',
    query: {},
    raw: {},
    url: '/validators/resource',
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

describe('conditional request lifecycle', () => {
  it('runs application and module middleware plus guards before classifying a conditional response', async () => {
    const events: string[] = [];

    class AuditGuard {
      canActivate() {
        events.push('guard');
        return true;
      }
    }

    class AuditMiddleware {
      async handle(_context: unknown, next: () => Promise<void>) {
        events.push('module-before');
        await next();
        events.push('module-after');
      }
    }

    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      @UseGuards(AuditGuard)
      getResource() {
        events.push('handler');
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      appMiddleware: [{
        async handle(_context, next) {
          events.push('app-before');
          await next();
          events.push('app-after');
        },
      }],
      conditionalRequest: {
        resolve() {
          events.push('resolver');
          return {
            exists: true,
            validators: { etag: { opaqueValue: 'resource-v1', strength: 'strong' } },
          };
        },
      },
      handlerMapping: createHandlerMapping([{
        controllerToken: ValidatorsController,
        moduleMiddleware: [AuditMiddleware],
      }]),
      rootContainer: new Container().register(AuditGuard, AuditMiddleware, ValidatorsController),
    });

    await dispatcher.dispatch(createRequest({ 'if-none-match': '"resource-v1"' }), createResponse());

    expect(events).toEqual([
      'app-before',
      'module-before',
      'guard',
      'resolver',
      'module-after',
      'app-after',
    ]);
  });

  it('continues from a successful If-Match to If-None-Match before conditionally writing the handler result', async () => {
    let handlerCalls = 0;

    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        handlerCalls += 1;
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              lastModified: new Date('2026-01-02T00:00:00Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({
      'if-match': '"resource-v1"',
      'if-none-match': 'W/"resource-v1"',
    }), response);

    expect(response.statusCode).toBe(304);
    expect(handlerCalls).toBe(0);
  });
});
