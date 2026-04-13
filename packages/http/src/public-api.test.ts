import { describe, expect, it } from 'vitest';

import * as httpPublicApi from './index.js';
import * as httpInternalApi from './internal.js';

describe('@fluojs/http public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(httpPublicApi).toHaveProperty('Controller');
    expect(httpPublicApi).toHaveProperty('Get');
    expect(httpPublicApi).toHaveProperty('Post');
    expect(httpPublicApi).toHaveProperty('Put');
    expect(httpPublicApi).toHaveProperty('Patch');
    expect(httpPublicApi).toHaveProperty('Delete');
    expect(httpPublicApi).toHaveProperty('All');
    expect(httpPublicApi).toHaveProperty('Options');
    expect(httpPublicApi).toHaveProperty('Head');
    expect(httpPublicApi).toHaveProperty('Header');
    expect(httpPublicApi).toHaveProperty('Redirect');
    expect(httpPublicApi).toHaveProperty('Version');
    expect(httpPublicApi).toHaveProperty('Produces');
    expect(httpPublicApi).toHaveProperty('RequestDto');
    expect(httpPublicApi).toHaveProperty('FromBody');
    expect(httpPublicApi).toHaveProperty('FromPath');
    expect(httpPublicApi).toHaveProperty('FromQuery');
    expect(httpPublicApi).toHaveProperty('FromHeader');
    expect(httpPublicApi).toHaveProperty('FromCookie');
    expect(httpPublicApi).toHaveProperty('Optional');
    expect(httpPublicApi).toHaveProperty('Convert');
    expect(httpPublicApi).toHaveProperty('UseGuards');
    expect(httpPublicApi).toHaveProperty('UseInterceptors');
    expect(httpPublicApi).toHaveProperty('createDispatcher');
    expect(httpPublicApi).toHaveProperty('createHandlerMapping');
    expect(httpPublicApi).toHaveProperty('forRoutes');
    expect(httpPublicApi).toHaveProperty('normalizeRoutePattern');
    expect(httpPublicApi).toHaveProperty('matchRoutePattern');
    expect(httpPublicApi).toHaveProperty('isMiddlewareRouteConfig');
  });

  it('does not expose internal pipeline runners or implementation classes', () => {
    expect(httpPublicApi).not.toHaveProperty('runGuardChain');
    expect(httpPublicApi).not.toHaveProperty('runInterceptorChain');
    expect(httpPublicApi).not.toHaveProperty('runMiddlewareChain');
    expect(httpPublicApi).not.toHaveProperty('DefaultConverter');
    expect(httpPublicApi).not.toHaveProperty('DefaultBinder');
    expect(httpPublicApi).not.toHaveProperty('getRouteProducesMetadata');
  });

  it('keeps the internal subpath limited to the documented exported helpers', () => {
    expect(httpInternalApi).toHaveProperty('DefaultBinder');
    expect(httpInternalApi).toHaveProperty('resolveClientIdentity');
    expect(Object.keys(httpInternalApi).sort()).toEqual(['DefaultBinder', 'resolveClientIdentity']);
  });
});
