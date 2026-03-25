import { bootstrapApplication } from '@konekti/runtime';

import {
  createRequestBuilder,
  createTestRequestContextMiddleware,
  makeRequest,
  type TestRequest,
  type TestRequestWithOptions,
  type TestResponse,
} from './http.js';
import type {
  TestApp,
  TestingModuleOptions,
  TestRequestOptions,
} from './types.js';

function normalizeRequestInput(
  methodOrRequest: string | TestRequest,
  pathOrOptions?: string | TestRequestOptions,
  options?: TestRequestOptions,
): TestRequestWithOptions {
  if (typeof methodOrRequest === 'string') {
    if (typeof pathOrOptions !== 'string') {
      throw new Error('Request path is required when using the (method, path, options) overload.');
    }

    return {
      ...options,
      method: methodOrRequest,
      path: pathOrOptions,
    };
  }

  if (typeof pathOrOptions === 'object') {
    return {
      ...methodOrRequest,
      ...pathOrOptions,
    };
  }

  return methodOrRequest;
}

export async function createTestApp(options: TestingModuleOptions): Promise<TestApp> {
  const app = await bootstrapApplication({
    ...options,
    middleware: [createTestRequestContextMiddleware()],
  });

  const request: TestApp['request'] = (
    methodOrRequest: string | TestRequest,
    pathOrOptions?: string | TestRequestOptions,
    options?: TestRequestOptions,
  ) => {
    return createRequestBuilder(app.dispatcher, normalizeRequestInput(methodOrRequest, pathOrOptions, options));
  };

  const dispatch: TestApp['dispatch'] = async (request: TestRequestWithOptions): Promise<TestResponse> => {
    return makeRequest(app.dispatcher, request);
  };

  return {
    request,
    dispatch,
    close: async () => {
      await app.close();
    },
  };
}
