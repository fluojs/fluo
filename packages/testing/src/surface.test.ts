import { describe, expect, it } from 'vitest';

import * as testing from './index.js';
import * as http from './http.js';
import * as mock from './mock.js';
import * as portability from './http-adapter-portability.js';
import * as webPortability from './web-runtime-adapter-portability.js';
import * as conformance from './platform-conformance.js';

describe('@konekti/testing surface', () => {
  it('keeps the root barrel focused on module/app helpers', () => {
    expect(testing.createTestingModule).toBeTypeOf('function');
    expect(testing.createTestApp).toBeTypeOf('function');
    expect(testing.extractModuleProviders).toBeTypeOf('function');
    expect('createMock' in testing).toBe(false);
    expect('makeRequest' in testing).toBe(false);
    expect('createPlatformConformanceHarness' in testing).toBe(false);
    expect('createHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createWebRuntimeHttpAdapterPortabilityHarness' in testing).toBe(false);
  });

  it('exposes responsibility-specific helpers from subpaths', () => {
    expect(mock.createMock).toBeTypeOf('function');
    expect(mock.createDeepMock).toBeTypeOf('function');
    expect(mock.mockToken).toBeTypeOf('function');
    expect(http.makeRequest).toBeTypeOf('function');
    expect(conformance.createPlatformConformanceHarness).toBeTypeOf('function');
    expect(portability.createHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(webPortability.createWebRuntimeHttpAdapterPortabilityHarness).toBeTypeOf('function');
  });
});
