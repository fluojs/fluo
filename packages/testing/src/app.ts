import { bootstrapApplication } from '@fluojs/runtime';

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

/**
 * Boots a lightweight test app with the real dispatcher and a fluent request client.
 *
 * @param options Testing bootstrap options, including the root module and any extra providers.
 * @returns A request-driven test app facade that dispatches through the real runtime stack.
 *
 * @example
 * ```ts
 * const app = await createTestApp({ rootModule: AppModule });
 * const response = await app.request('GET', '/health').send();
 * await app.close();
 * ```
 */
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
