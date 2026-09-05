import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';
import * as runtimeInternalHttpAdapter from './adapters/internal-http-adapter.js';
import * as runtimeInternalRequestResponseFactory from './adapters/internal-request-response-factory.js';
import * as runtimeDevtools from './devtools/index.js';
import * as runtime from './index.js';
import * as runtimeInternal from './internal.js';
import * as runtimeWeb from './web.js';
import {
  MultipartBodyConsumedError,
  type MultipartFieldPart,
  type MultipartFilePart,
  type MultipartPart,
} from './web.js';

describe('runtime export boundaries', () => {
  it('keeps the root barrel transport-neutral', () => {
    expect(runtime).not.toHaveProperty('parseMultipart');
    expect(runtime).not.toHaveProperty('dispatchWebRequest');
    expect(runtime).not.toHaveProperty('createWebRequestResponseFactory');
    expect(runtime).not.toHaveProperty('createNodeShutdownSignalRegistration');
    expect(runtime).not.toHaveProperty('bootstrapHttpAdapterApplication');
  });

  it('keeps root bootstrap defaults detached from Node-only logger modules', () => {
    const bootstrapSource = readFileSync(new URL('./bootstrap.ts', import.meta.url), 'utf8');

    expect(bootstrapSource).not.toContain('./logging/logger.js');
    expect(bootstrapSource).not.toContain('./logging/json-logger.js');
    expect(bootstrapSource).toContain('./logging/default-logger.js');
  });

  it('keeps only bootstrap-scoped operational helpers on the runtime root barrel', () => {
    expect(runtime.HealthModule).toBeTypeOf('function');
    expect(runtime.HealthModule.forRoot).toBeTypeOf('function');
    expect(runtime).toHaveProperty('createHealthModule');
    expect(runtime.fluoFactory).toBe(runtime.FluoFactory);
    expect(runtime).not.toHaveProperty('createConsoleApplicationLogger');
    expect(runtime).not.toHaveProperty('createJsonApplicationLogger');
    expect(runtime).toHaveProperty('APPLICATION_LOGGER');
    expect(runtime).toHaveProperty('PLATFORM_SHELL');
    expect(runtime).not.toHaveProperty('MetricsModule');
    expect(runtime).not.toHaveProperty('TerminusModule');
  });

  it('keeps internal root focused on wiring tokens and runtime-owned metadata seams', () => {
    expect(Object.keys(runtimeInternal).sort()).toEqual([
      'APPLICATION_LOGGER',
      'BOOTSTRAP_PROVIDER_TOKENS',
      'BOOTSTRAP_READY_SIGNAL',
      'COMPILED_MODULES',
      'HTTP_APPLICATION_ADAPTER',
      'PLATFORM_SHELL',
      'RUNTIME_CLEANUP_REGISTRATION',
      'RUNTIME_CONTAINER',
      'createRuntimeRouteInspection',
      'defineLegacyRuntimeRouteInspectionMetadata',
      'defineModule',
      'defineStandardRuntimeRouteInspectionMetadata',
      'getRuntimeClassDiMetadata',
      'getRuntimeRouteInspectionMetadata',
    ]);
  });

  it('keeps portable transport helpers on explicit subpaths', () => {
    expect(runtimeWeb.parseMultipart).toBeTypeOf('function');
    expect(runtimeWeb.parseMultipartStream).toBeTypeOf('function');
    expect(runtimeInternalHttpAdapter.bootstrapHttpAdapterApplication).toBeTypeOf('function');
    expect(runtimeInternalHttpAdapter.createDefaultApplicationLogger).toBeTypeOf('function');
    expect(runtimeInternalHttpAdapter).not.toHaveProperty('createConsoleApplicationLogger');
    expect(runtimeInternalHttpAdapter.runHttpAdapterApplication).toBeTypeOf('function');
    expect(runtimeInternalRequestResponseFactory.dispatchWithRequestResponseFactory).toBeTypeOf('function');
  });

  it('keeps the devtools subpath to the supported host bridge contract', () => {
    expect(Object.keys(runtimeDevtools).sort()).toEqual([
      'StudioDevtoolsRuntime',
    ]);
  });

  it('exports multipart streaming contracts from the Web subpath', () => {
    expect(MultipartBodyConsumedError).toBeTypeOf('function');
    expectTypeOf<MultipartPart>().toEqualTypeOf<MultipartFieldPart | MultipartFilePart>();
  });

  it('declares the narrowed package export map', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports).not.toHaveProperty('./node');
    expect(packageJson.exports).toHaveProperty('./web');
    expect(packageJson.exports).toMatchObject({
      './devtools': {
        import: './dist/devtools/index.js',
        types: './dist/devtools/index.d.ts',
      },
    });
    expect(packageJson.exports).toHaveProperty('./internal');
    expect(packageJson.exports).toHaveProperty('./internal/http-adapter');
    expect(packageJson.exports).toHaveProperty('./internal/request-response-factory');
    expect(packageJson.exports).not.toHaveProperty('./internal-node');
  });
});
