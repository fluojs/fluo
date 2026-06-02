import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type {
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
} from '../../types.js';
import { executeFastPath } from './fast-path-executor.js';

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/health',
    query: {},
    raw: {},
    url: '/health',
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

function createSimpleJsonResponse(
  headers: Record<string, string | string[]> = {},
): FrameworkResponse & {
  simpleJsonBody?: Record<string, unknown> | unknown[];
  sendSimpleJson(body: Record<string, unknown> | unknown[]): void;
} {
  return {
    ...createResponse(),
    headers,
    sendSimpleJson(body) {
      this.simpleJsonBody = body;
      this.committed = true;
    },
  };
}

class HealthController {
  health() {
    return { ok: true };
  }
}

function createHealthDescriptor(): HandlerDescriptor {
  return {
    controllerToken: HealthController,
    metadata: {
      controllerPath: '/health',
      effectivePath: '/health',
      moduleMiddleware: [],
      pathParams: [],
    },
    methodName: 'health',
    route: {
      method: 'GET',
      path: '/health',
    },
  };
}

describe('executeFastPath', () => {
  it('returns synchronously for cached singleton handlers without dto binding or async response writers', () => {
    const request = createRequest();
    const response = createResponse();
    const context: RequestContext = {
      container: new Container(),
      metadata: {},
      request,
      response,
    };
    const controller = new HealthController();

    const result = executeFastPath({
      controller,
      controllerContainer: context.container,
      handler: createHealthDescriptor(),
      method: controller.health,
      request,
      requestContext: context,
      response,
    });

    expect(isThenable(result)).toBe(false);
    expect(result).toEqual({ executed: true, result: { ok: true } });
    expect(response.body).toEqual({ ok: true });
  });

  it('does not enumerate response headers for simple JSON writes without content type overrides', () => {
    let headerEnumerationCount = 0;
    const headers = new Proxy<Record<string, string | string[]>>({}, {
      ownKeys(target) {
        headerEnumerationCount += 1;
        return Reflect.ownKeys(target);
      },
    });
    const request = createRequest();
    const response = createSimpleJsonResponse(headers);
    const context: RequestContext = {
      container: new Container(),
      metadata: {},
      request,
      response,
    };
    const controller = new HealthController();

    executeFastPath({
      controller,
      controllerContainer: context.container,
      handler: createHealthDescriptor(),
      method: controller.health,
      request,
      requestContext: context,
      response,
    });

    expect(headerEnumerationCount).toBe(0);
    expect(response.simpleJsonBody).toEqual({ ok: true });
  });
});

function isThenable(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}
