import { describe, expect, it } from 'vitest';

import {
  All,
  Controller,
  createHandlerMapping,
  type FrameworkRequest,
  Get,
  Head,
  InvalidRoutePathError,
  Version,
  VersioningType,
} from './index.js';

function request(path: string, headRouting?: FrameworkRequest['headRouting']): FrameworkRequest {
  return {
    method: 'HEAD',
    headRouting,
    path,
    url: path,
    headers: {},
    cookies: {},
    query: {},
    params: {},
    raw: undefined,
  };
}

describe('opt-in HEAD mapping', () => {
  it.each([
    { path: '/articles/42', selected: 'head', params: { id: '42' } },
    { path: '/all/42', selected: 'all', params: { id: '42' } },
    { path: '//get/42/', selected: 'get', params: { id: '42' } },
    { path: '/missing', selected: undefined, params: undefined },
  ])('resolves $path before dispatch', ({ path, selected, params }) => {
    // Given explicit HEAD, method-wildcard ALL, and GET candidates.
    @Controller()
    class Routes {
      @Get('/articles/42')
      articleGet() {}
      @All('/articles/42')
      articleAll() {}
      @Head('/articles/:id')
      head() {}
      @Get('/all/42')
      allGet() {}
      @All('/all/:id')
      all() {}
      @Get('/get/:id')
      get() {}
    }
    const mapping = createHandlerMapping([{ controllerToken: Routes }]);
    const incoming = request(path, 'explicit-or-get');
    // When the opt-in lookup chooses a single descriptor.
    const match = mapping.match(incoming);
    // Then method priority applies before the existing within-method path rules.
    expect(match?.descriptor.methodName).toBe(selected);
    expect(match?.params).toEqual(params);
    expect(incoming.method).toBe('HEAD');
    expect(incoming.params).toEqual({});
  });

  it('extracts a version once from the original HEAD request before GET selection', () => {
    // Given a custom extractor that would select a different version for GET.
    const methods: string[] = [];
    @Controller('/versioned')
    class Routes {
      @Get()
      @Version('2')
      get() {}
      @Head()
      @Version('1')
      head() {}
    }
    const mapping = createHandlerMapping([{ controllerToken: Routes }], {
      versioning: {
        type: VersioningType.CUSTOM,
        extractor(incoming) {
          methods.push(incoming.method);
          return incoming.method === 'HEAD' ? '2' : '1';
        },
      },
    });
    // When HEAD has no eligible explicit version.
    const match = mapping.match(request('/versioned', 'explicit-or-get'));
    // Then GET supplies the same selected version without another extraction.
    expect(match?.descriptor.methodName).toBe('get');
    expect(methods).toEqual(['HEAD']);
  });

  it('preserves default matching and GET method semantics', () => {
    // Given ordinary method-specific routes.
    @Controller('/default')
    class Routes {
      @Get()
      get() {}
    }
    const mapping = createHandlerMapping([{ controllerToken: Routes }]);
    // When no HEAD policy is selected or the request is GET.
    const head = mapping.match(request('/default'));
    const get = mapping.match({ ...request('/default', 'explicit-or-get'), method: 'GET' });
    // Then the generic HEAD miss and ordinary GET hit remain unchanged.
    expect(head).toBeUndefined();
    expect(get?.descriptor.methodName).toBe('get');
  });

  it('does not turn ALL method matching into wildcard path grammar', () => {
    // Given an unsupported path wildcard.
    // When a route attempts to register it.
    const defineWildcard = () => {
      @Controller()
      class Routes {
        @All('/articles/*')
        all() {}
      }
      return createHandlerMapping([{ controllerToken: Routes }]);
    };
    // Then the existing route-grammar error remains authoritative.
    expect(defineWildcard).toThrow(InvalidRoutePathError);
  });
});
