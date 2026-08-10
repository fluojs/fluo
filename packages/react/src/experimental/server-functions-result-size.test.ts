import { Module } from '@fluojs/core';
import {
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  Post,
  type RequestContext,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  createReactServerFunctionRegistry,
  REACT_SERVER_FUNCTION_ERROR_CODES,
  REACT_SERVER_FUNCTION_REQUEST_HEADER,
  type ReactServerFunctionReference,
} from './rsc.js';

type DispatchResultInput = {
  readonly maxResultBytes: number;
  readonly result: string;
};

type TestResponse = FrameworkResponse & { body?: unknown };

const encoder = new TextEncoder();
const secret = new Uint8Array(32).fill(17);

function createRequest(reference: ReactServerFunctionReference): FrameworkRequest {
  const body = { action: reference.value, args: [] };
  return {
    body,
    cookies: {},
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      [REACT_SERVER_FUNCTION_REQUEST_HEADER]: '1',
    },
    method: 'POST',
    params: {},
    path: '/_fluo/actions',
    query: {},
    raw: {},
    rawBody: encoder.encode(JSON.stringify(body)),
    url: '/_fluo/actions',
  };
}

function createResponse(): TestResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

async function dispatchResult(input: DispatchResultInput): Promise<TestResponse> {
  const registry = createReactServerFunctionRegistry({
    actions: { measure: () => input.result },
    allowedOrigins: ['https://app.example.com'],
    crypto: globalThis.crypto,
    maxResultBytes: input.maxResultBytes,
    secret,
  });
  const reference = await registry.createReference('measure');

  @Controller('/_fluo')
  class ActionController {
    @Post('/actions')
    invoke(_input: undefined, context: RequestContext) {
      return registry.invoke(context);
    }
  }

  @Module({ controllers: [ActionController] })
  class AppModule {}

  const app = await bootstrapApplication({ rootModule: AppModule });
  const response = createResponse();
  try {
    await app.dispatch(createRequest(reference), response);
    return response;
  } finally {
    await app.close();
  }
}

describe('experimental React Server Function result-size boundary', () => {
  it('returns the stable HTTP error when a result exceeds maxResultBytes by one byte', async () => {
    // Given: a seven-character ASCII string whose JSON encoding is nine bytes.
    const maxResultBytes = 8;

    // When: the action result crosses the ordinary fluo HTTP dispatch boundary.
    const response = await dispatchResult({ maxResultBytes, result: '1234567' });

    // Then: the result is rejected with the documented stable HTTP failure.
    expect(response).toMatchObject({
      body: {
        error: {
          code: REACT_SERVER_FUNCTION_ERROR_CODES.resultTooLarge,
          status: 500,
        },
      },
      statusCode: 500,
    });
  });

  it('accepts a result whose serialized bytes equal maxResultBytes exactly', async () => {
    // Given: a six-character ASCII string whose JSON encoding is exactly eight bytes.
    const maxResultBytes = 8;

    // When: the exact-boundary action result crosses the ordinary fluo HTTP dispatch boundary.
    const response = await dispatchResult({ maxResultBytes, result: '123456' });

    // Then: the action result keeps the normal successful POST response.
    expect(response).toMatchObject({
      body: { result: '123456' },
      statusCode: 201,
    });
  });
});
