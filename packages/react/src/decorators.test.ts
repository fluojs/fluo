import { describe, expect, it } from 'vitest';

import {
  FromPath,
  Header,
  InvalidRoutePathError,
  RequestDto,
  UseGuards,
  UseInterceptors,
  Version,
  createHandlerMapping,
} from '@fluojs/http';
import { getControllerMetadata, getRouteMetadata } from '@fluojs/core/internal';

import {
  Path,
  Router,
  getReactPathMetadata,
  getReactRouterMetadata,
} from './decorators.js';

class DashboardAuthGuard {
  canActivate() {
    return true;
  }
}

class DashboardEditGuard {
  canActivate() {
    return true;
  }
}

class AuditInterceptor {
  intercept(_context: unknown, next: { handle(): Promise<unknown> }) {
    return next.handle();
  }
}

class RenderInterceptor {
  intercept(_context: unknown, next: { handle(): Promise<unknown> }) {
    return next.handle();
  }
}

class DashboardEditRequest {
  @FromPath('id')
  id = '';
}

function createGetRequest(path: string) {
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

describe('React router decorators', () => {
  it('writes HTTP controller/GET route metadata and React marker metadata', () => {
    @Router('/dashboard')
    class DashboardRouter {
      @Path('/:id/edit', { view: 'dashboard-edit' })
      edit() {
        return { ok: true };
      }
    }

    expect(getControllerMetadata(DashboardRouter)).toEqual({
      basePath: '/dashboard',
      guards: undefined,
      interceptors: undefined,
      version: undefined,
    });
    expect(getRouteMetadata(DashboardRouter.prototype, 'edit')).toEqual({
      guards: undefined,
      interceptors: undefined,
      method: 'GET',
      path: '/:id/edit',
    });
    expect(getReactRouterMetadata(DashboardRouter)).toEqual({
      basePath: '/dashboard',
      kind: 'router',
    });
    expect(getReactPathMetadata(DashboardRouter, 'edit')).toEqual({
      kind: 'path',
      options: { view: 'dashboard-edit' },
      path: '/:id/edit',
    });
  });

  it('appears in createHandlerMapping as GET routes using the HTTP matcher', () => {
    @Router('/dashboard')
    class DashboardRouter {
      @Path('/')
      index() {
        return { page: 'index' };
      }

      @Path('/:id')
      show() {
        return { page: 'show' };
      }

      @Path('/:id/edit')
      edit() {
        return { page: 'edit' };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: DashboardRouter }]);

    const indexMatch = mapping.match(createGetRequest('/dashboard'));
    const showMatch = mapping.match(createGetRequest('/dashboard/42'));
    const editMatch = mapping.match(createGetRequest('/dashboard/42/edit'));

    expect(indexMatch?.descriptor.methodName).toBe('index');
    expect(indexMatch?.descriptor.route).toMatchObject({ method: 'GET', path: '/dashboard' });
    expect(showMatch?.descriptor.methodName).toBe('show');
    expect(showMatch?.params).toEqual({ id: '42' });
    expect(editMatch?.descriptor.methodName).toBe('edit');
    expect(editMatch?.descriptor.metadata.pathParams).toEqual(['id']);
    expect(editMatch?.params).toEqual({ id: '42' });
  });

  it('composes with request DTOs, versions, guards, interceptors, and headers', () => {
    @Version('1')
    @UseGuards(DashboardAuthGuard)
    @UseInterceptors(AuditInterceptor)
    @Router('/dashboard')
    class DashboardRouter {
      @Header('x-react-route', 'dashboard-edit')
      @UseGuards(DashboardEditGuard)
      @UseInterceptors(RenderInterceptor)
      @Version('2')
      @RequestDto(DashboardEditRequest)
      @Path('/:id/edit')
      edit(_input: DashboardEditRequest) {
        return { page: 'edit' };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: DashboardRouter }]);
    const descriptor = mapping.descriptors[0];

    expect(descriptor).toMatchObject({
      metadata: {
        controllerPath: '/dashboard',
        effectivePath: '/v2/dashboard/:id/edit',
        effectiveVersion: '2',
        pathParams: ['id'],
      },
      route: {
        headers: [{ name: 'x-react-route', value: 'dashboard-edit' }],
        method: 'GET',
        path: '/v2/dashboard/:id/edit',
        request: DashboardEditRequest,
        version: '2',
      },
    });
    expect(descriptor?.route.guards).toEqual([DashboardAuthGuard, DashboardEditGuard]);
    expect(descriptor?.route.interceptors).toEqual([AuditInterceptor, RenderInterceptor]);
    expect(mapping.match(createGetRequest('/v2/dashboard/42/edit'))?.params).toEqual({ id: '42' });
  });

  it('rejects unsupported route grammar through the HTTP validation behavior', () => {
    expect(() => Router('/files/*')).toThrow(InvalidRoutePathError);
    expect(() => Path('/files/:id.json')).toThrow(InvalidRoutePathError);
    expect(() => Path('/files?')).toThrow(InvalidRoutePathError);
    expect(() => Path('/(.*)')).toThrow(InvalidRoutePathError);
  });
});
