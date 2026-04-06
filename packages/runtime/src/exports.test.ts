import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as runtime from './index.js';
import * as runtimeInternal from './internal.js';
import * as runtimeInternalHttpAdapter from './internal-http-adapter.js';
import * as runtimeInternalRequestResponseFactory from './internal-request-response-factory.js';
import * as runtimeNode from './node.js';
import * as runtimeWeb from './web.js';

describe('runtime export boundaries', () => {
  it('keeps the root barrel transport-neutral', () => {
    expect(runtime).not.toHaveProperty('parseMultipart');
    expect(runtime).not.toHaveProperty('dispatchWebRequest');
    expect(runtime).not.toHaveProperty('createWebRequestResponseFactory');
    expect(runtime).not.toHaveProperty('createNodeShutdownSignalRegistration');
    expect(runtime).not.toHaveProperty('bootstrapHttpAdapterApplication');
  });

  it('keeps internal root focused on wiring tokens', () => {
    expect(Object.keys(runtimeInternal).sort()).toEqual([
      'APPLICATION_LOGGER',
      'COMPILED_MODULES',
      'HTTP_APPLICATION_ADAPTER',
      'PLATFORM_SHELL',
      'RUNTIME_CONTAINER',
    ]);
  });

  it('moves transport helpers onto explicit subpaths', () => {
    expect(runtimeWeb.parseMultipart).toBeTypeOf('function');
    expect(runtimeNode.createNodeShutdownSignalRegistration).toBeTypeOf('function');
    expect(runtimeNode.defaultNodeShutdownSignals).toBeTypeOf('function');
    expect(runtimeInternalHttpAdapter.bootstrapHttpAdapterApplication).toBeTypeOf('function');
    expect(runtimeInternalHttpAdapter.runHttpAdapterApplication).toBeTypeOf('function');
    expect(runtimeInternalRequestResponseFactory.dispatchWithRequestResponseFactory).toBeTypeOf('function');
  });

  it('declares the narrowed package export map', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> };

    expect(packageJson.exports).toHaveProperty('./web');
    expect(packageJson.exports).toHaveProperty('./internal');
    expect(packageJson.exports).toHaveProperty('./internal/http-adapter');
    expect(packageJson.exports).toHaveProperty('./internal/request-response-factory');
  });
});
