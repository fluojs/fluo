import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, HandlerDescriptor } from '../types.js';
import { writeSuccessResponse } from './dispatch-response-policy.js';

class ResponsePolicyController {}

function createHandler(): HandlerDescriptor {
  return {
    controllerToken: ResponsePolicyController,
    metadata: {
      controllerPath: '/response-policy',
      effectivePath: '/response-policy',
      moduleMiddleware: [],
      pathParams: [],
    },
    methodName: 'getValue',
    route: {
      method: 'GET',
      path: '/response-policy',
    },
  };
}

function createRequest(): FrameworkRequest {
  return {
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/response-policy',
    query: {},
    raw: {},
    url: '/response-policy',
  };
}

function createResponse(): FrameworkResponse & {
  body?: unknown;
  simpleJsonBody?: Record<string, unknown> | unknown[];
  sendSimpleJson(body: Record<string, unknown> | unknown[]): void;
} {
  return {
    committed: false,
    headers: {
      'CoNtEnT-TyPe': 'application/json; charset=utf-8',
    },
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    sendSimpleJson(body) {
      this.simpleJsonBody = body;
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

describe('dispatch response policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes simple JSON for mixed-case JSON content type without Object.entries allocation', () => {
    vi.spyOn(Object, 'entries').mockImplementation(() => {
      throw new Error('Object.entries should not be used for response header lookup');
    });
    const response = createResponse();

    writeSuccessResponse(
      createHandler(),
      createRequest(),
      response,
      { ok: true },
      undefined,
    );

    expect(response.statusCode).toBe(200);
    expect(response.simpleJsonBody).toEqual({ ok: true });
    expect(response.body).toBeUndefined();
  });
});
