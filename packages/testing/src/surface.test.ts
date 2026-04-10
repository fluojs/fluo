import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as testing from './index.js';
import * as http from './http.js';
import * as mock from './mock.js';
import * as portability from './portability/http-adapter-portability.js';
import * as webPortability from './portability/web-runtime-adapter-portability.js';
import * as conformance from './conformance/platform-conformance.js';
import * as fetchStyleWebsocket from './conformance/fetch-style-websocket-conformance.js';

describe('@fluojs/testing surface', () => {
  it('keeps the root barrel focused on module/app helpers', () => {
    expect(testing.createTestingModule).toBeTypeOf('function');
    expect(testing.createTestApp).toBeTypeOf('function');
    expect(testing.extractModuleProviders).toBeTypeOf('function');
    expect('createMock' in testing).toBe(false);
    expect('makeRequest' in testing).toBe(false);
    expect('createPlatformConformanceHarness' in testing).toBe(false);
    expect('createHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createWebRuntimeHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createFetchStyleWebSocketConformanceHarness' in testing).toBe(false);
  });

  it('exposes responsibility-specific helpers from subpaths', () => {
    expect(mock.createMock).toBeTypeOf('function');
    expect(mock.createDeepMock).toBeTypeOf('function');
    expect(mock.mockToken).toBeTypeOf('function');
    expect(http.makeRequest).toBeTypeOf('function');
    expect(conformance.createPlatformConformanceHarness).toBeTypeOf('function');
    expect(portability.createHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(webPortability.createWebRuntimeHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(fetchStyleWebsocket.createFetchStyleWebSocketConformanceHarness).toBeTypeOf('function');
  });

  it('keeps published subpath metadata aligned with the built surface', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
      peerDependencies: Record<string, string>;
    };

    expect(packageJson.exports['./platform-conformance']).toEqual({
      types: './dist/platform-conformance.d.ts',
      import: './dist/platform-conformance.js',
    });
    expect(packageJson.exports['./http-adapter-portability']).toEqual({
      types: './dist/http-adapter-portability.d.ts',
      import: './dist/http-adapter-portability.js',
    });
    expect(packageJson.exports['./web-runtime-adapter-portability']).toEqual({
      types: './dist/web-runtime-adapter-portability.d.ts',
      import: './dist/web-runtime-adapter-portability.js',
    });
    expect(packageJson.exports['./fetch-style-websocket-conformance']).toEqual({
      types: './dist/fetch-style-websocket-conformance.d.ts',
      import: './dist/fetch-style-websocket-conformance.js',
    });
    expect(packageJson.peerDependencies.vitest).toBe('^3.0.8');
  });
});
