import { Module } from '@fluojs/core';
import { appendDtoFieldValidationRule } from '@fluojs/core/request-pipeline';
import {
  Controller,
  Convert,
  FromBody,
  FromCookie,
  FromHeader,
  FromPath,
  FromQuery,
  Get,
  RequestDto,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';

type TestResponse = FrameworkResponse & { body?: unknown };

function createRequest(path: string, overrides: Partial<FrameworkRequest> = {}): FrameworkRequest {
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
    ...overrides,
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

function requireQueryValue(prototype: object, propertyKey: string): void {
  appendDtoFieldValidationRule(prototype, propertyKey, {
    code: 'VALUE_REQUIRED',
    kind: 'minLength',
    message: 'value is required',
    value: 1,
  });
}

describe('React page HTTP lifecycle binding', () => {
  it('binds request DTO values from path, query, header, cookie, and body fields', async () => {
    class PageRequest {
      @FromPath('slug')
      slug = '';

      @FromQuery('tab')
      tab = '';

      @FromHeader('x-page-mode')
      mode = '';

      @FromCookie('session')
      session = '';

      @FromBody('draft')
      draft = '';
    }

    @Router('/pages')
    class PageRouter {
      @Path('/:slug')
      @RequestDto(PageRequest)
      show(input: PageRequest) {
        return input;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [PageRouter] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a React page route is registered through ReactModule and declares HTTP DTO bindings.
      const response = createResponse();

      // When: the dispatcher receives a GET page request with all request sources populated.
      await app.dispatch(
        createRequest('/pages/intro', {
          body: { draft: 'enabled' },
          cookies: { session: 'cookie-123' },
          headers: { 'x-page-mode': 'preview' },
          query: { tab: 'settings' },
        }),
        response,
      );

      // Then: the same HTTP binder materializes the React page DTO.
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        draft: 'enabled',
        mode: 'preview',
        session: 'cookie-123',
        slug: 'intro',
        tab: 'settings',
      });
    } finally {
      await app.close();
    }
  });

  it('applies field-level converters before invoking React page handlers', async () => {
    class TrimConverter {
      convert(value: unknown) {
        return typeof value === 'string' ? value.trim() : value;
      }
    }

    class SearchRequest {
      @Convert(TrimConverter)
      @FromQuery('q')
      query = '';
    }

    @Router('/search')
    class SearchRouter {
      @Path('/')
      @RequestDto(SearchRequest)
      index(input: SearchRequest) {
        return input;
      }
    }

    @Module({ imports: [ReactModule.forRoot({ controllers: [SearchRouter] })] })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a React page route uses an HTTP field converter.
      const response = createResponse();

      // When: the request carries an untrimmed query value.
      await app.dispatch(createRequest('/search', { query: { q: '  fluo  ' } }), response);

      // Then: converter output is passed to the page handler.
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ query: 'fluo' });
    } finally {
      await app.close();
    }
  });

  it('returns the same validation error envelope as an ordinary HTTP controller', async () => {
    class RequiredQueryRequest {
      @FromQuery('value')
      value = '';
    }

    requireQueryValue(RequiredQueryRequest.prototype, 'value');

    @Controller('/api')
    class ApiController {
      @Get('/required')
      @RequestDto(RequiredQueryRequest)
      required(input: RequiredQueryRequest) {
        return input;
      }
    }

    @Router('/page')
    class PageRouter {
      @Path('/required')
      @RequestDto(RequiredQueryRequest)
      required(input: RequiredQueryRequest) {
        return input;
      }
    }

    @Module({
      controllers: [ApiController],
      imports: [ReactModule.forRoot({ controllers: [PageRouter] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: an ordinary controller and a React page share the same validated request DTO.
      const apiResponse = createResponse();
      const pageResponse = createResponse();
      const invalidRequest = { headers: { 'x-request-id': 'req-validation-400' }, query: { value: '' } };

      // When: both routes receive invalid query data.
      await app.dispatch(createRequest('/api/required', invalidRequest), apiResponse);
      await app.dispatch(createRequest('/page/required', invalidRequest), pageResponse);

      // Then: React page validation preserves ordinary HTTP error semantics exactly.
      expect(apiResponse.statusCode).toBe(400);
      expect(pageResponse.statusCode).toBe(400);
      expect(pageResponse.body).toEqual(apiResponse.body);
      expect(pageResponse.body).toEqual({
        error: {
          code: 'BAD_REQUEST',
          details: [
            {
              code: 'VALUE_REQUIRED',
              field: 'value',
              message: 'value is required',
              source: 'query',
            },
          ],
          message: 'Validation failed.',
          meta: undefined,
          requestId: 'req-validation-400',
          status: 400,
        },
      });
    } finally {
      await app.close();
    }
  });
});
