import { Inject, Module, Scope } from '@fluojs/core';
import {
  type CallHandler,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
  FromPath,
  type GuardContext,
  Header,
  HttpCode,
  type InterceptorContext,
  type MiddlewareContext,
  type Next,
  RequestDto,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { createReactServerEntry } from './server-entry.js';

const TEXT_DECODER = new TextDecoder();

type StreamedResponse = FrameworkResponse & {
  readonly chunks: readonly string[];
  readonly closed: boolean;
};

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

function createStreamedResponse(): StreamedResponse {
  const chunks: string[] = [];
  let closed = false;

  const stream: FrameworkResponseStream = {
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
    flush() {},
    waitForDrain() {
      return Promise.resolve();
    },
    write(chunk: string | Uint8Array) {
      chunks.push(typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(chunk, { stream: true }));
      return true;
    },
  };

  return {
    committed: false,
    get closed() {
      return closed;
    },
    get chunks() {
      return chunks;
    },
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      if (body instanceof Uint8Array) {
        chunks.push(TEXT_DECODER.decode(body));
      } else if (typeof body === 'string') {
        chunks.push(body);
      } else if (body !== undefined) {
        chunks.push(JSON.stringify(body));
      }
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    stream,
  };
}

describe('React SSR dispatcher integration', () => {
  it('runs the HTTP pipeline before finalizing a streamed HTML React entry', async () => {
    class DashboardRequest {
      @FromPath('id')
      id = '';
    }

    class DashboardPresenter {
      render(id: string, requestInstanceId: number) {
        return createElement('main', null, `Dashboard ${id} request ${requestInstanceId}`);
      }
    }

    @Scope('request')
    class RequestMarker {
      private static nextId = 0;
      readonly id = ++RequestMarker.nextId;
    }

    class ReactTraceMiddleware {
      async handle(context: MiddlewareContext, next: Next): Promise<void> {
        context.response.setHeader('x-react-module', 'middleware');
        await next();
      }
    }

    class AllowGuard {
      canActivate(context: GuardContext) {
        context.requestContext.response.setHeader('x-react-guard', context.requestContext.request.params.id ?? 'missing');
        return true;
      }
    }

    class BeforeRenderInterceptor {
      intercept(context: InterceptorContext, next: CallHandler) {
        context.requestContext.response.setHeader('x-react-interceptor', 'before-render');
        return next.handle();
      }
    }

    @Inject(DashboardPresenter, RequestMarker)
    @Scope('request')
    @UseGuards(AllowGuard)
    @UseInterceptors(BeforeRenderInterceptor)
    @Router('/dashboard')
    class DashboardRouter {
      constructor(
        private readonly presenter: DashboardPresenter,
        private readonly marker: RequestMarker,
      ) {}

      @Header('x-react-route', 'dashboard')
      @HttpCode(206)
      @Path('/:id')
      @RequestDto(DashboardRequest)
      show(input: DashboardRequest) {
        return createReactServerEntry(this.presenter.render(input.id, this.marker.id), {
          headers: { 'x-react-entry': 'server' },
        });
      }
    }

    @Module({
      imports: [
        ReactModule.forRoot({
          controllers: [DashboardRouter],
          middleware: [ReactTraceMiddleware],
          providers: [DashboardPresenter, RequestMarker, AllowGuard, BeforeRenderInterceptor],
        }),
      ],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const firstResponse = createStreamedResponse();
      await app.dispatch(createRequest('/dashboard/42'), firstResponse);
      const secondResponse = createStreamedResponse();
      await app.dispatch(createRequest('/dashboard/42'), secondResponse);

      expect(firstResponse.statusCode).toBe(206);
      expect(firstResponse.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(firstResponse.headers['x-react-module']).toBe('middleware');
      expect(firstResponse.headers['x-react-guard']).toBe('42');
      expect(firstResponse.headers['x-react-interceptor']).toBe('before-render');
      expect(firstResponse.headers['x-react-route']).toBe('dashboard');
      expect(firstResponse.headers['x-react-entry']).toBe('server');
      expect(firstResponse.committed).toBe(true);
      expect(firstResponse.closed).toBe(true);
      expect(firstResponse.chunks.join('')).toContain('Dashboard 42 request 1');
      expect(secondResponse.chunks.join('')).toContain('Dashboard 42 request 2');
    } finally {
      await app.close();
    }
  });

  it('does not leak route success headers when React shell rendering fails before commit', async () => {
    class ReactShellRenderError extends Error {
      readonly name = 'ReactShellRenderError';

      constructor() {
        super('React shell render failed before commit.');
      }
    }

    function BrokenShell(): never {
      throw new ReactShellRenderError();
    }

    @Router('/broken')
    class BrokenRouter {
      @Header('x-react-route', 'broken')
      @HttpCode(206)
      @Path('/')
      show() {
        return createReactServerEntry(createElement(BrokenShell));
      }
    }

    @Module({
      imports: [
        ReactModule.forRoot({
          controllers: [BrokenRouter],
        }),
      ],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a React page route declares success-only HTTP metadata.
      const response = createStreamedResponse();

      // When: the React shell render fails before response bytes commit.
      await app.dispatch(createRequest('/broken'), response);

      // Then: the dispatcher writes the JSON error envelope without stale success headers.
      expect(response.statusCode).toBe(500);
      expect(response.headers['x-react-route']).toBeUndefined();
      expect(response.chunks.join('')).toContain('INTERNAL_SERVER_ERROR');
    } finally {
      await app.close();
    }
  });
});
