import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  ByteRangeResponseOptions,
  ByteRangeResponseSource,
  ClearCookieOptions,
  CookieOptions,
  CookieSameSite,
  HttpConnection,
  ResponseFormatter,
} from './index.js';
import * as httpPublicApi from './index.js';
import * as httpInternalApi from './internal.js';
import type {
  ByteRangeResponseOptions as PortableByteRangeResponseOptions,
  ByteRangeResponseSource as PortableByteRangeResponseSource,
} from './index.portable.js';
import * as portableHttpPublicApi from './index.portable.js';

type TypeEquals<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2)
  ? (<Value>() => Value extends Right ? 1 : 2) extends (<Value>() => Value extends Left ? 1 : 2)
    ? true
    : false
  : false;

type AssertTrue<Condition extends true> = Condition;

const runtimeStaticModuleSpecifierPattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const runtimeDynamicModuleSpecifierPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const runtimeDynamicTemplateModuleSpecifierPattern = /\bimport\(\s*`([^`]*)`\s*\)/g;

function readRuntimeModuleSpecifiers(source: string): string[] {
  const quotedSpecifiers = [
    ...source.matchAll(runtimeStaticModuleSpecifierPattern),
    ...source.matchAll(runtimeDynamicModuleSpecifierPattern),
  ].flatMap((match) => {
    const specifier = match[1];
    return specifier === undefined ? [] : [specifier];
  });
  const templateSpecifiers = [...source.matchAll(runtimeDynamicTemplateModuleSpecifierPattern)].flatMap((match) => {
    const specifier = match[1];
    return specifier === undefined || specifier.includes('${') ? [] : [specifier];
  });

  return [...quotedSpecifiers, ...templateSpecifiers];
}

function resolveWorkspacePackageSourceUrl(specifier: string): URL | undefined {
  const match = /^@fluojs\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  const packageName = match?.[1];

  if (packageName === undefined) {
    return undefined;
  }

  const packageRoot = new URL(`../../${packageName}/`, import.meta.url);
  const manifest: unknown = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'));

  if (typeof manifest !== 'object' || manifest === null || Reflect.get(manifest, 'name') !== `@fluojs/${packageName}`) {
    throw new TypeError(`Invalid workspace package manifest for ${specifier}.`);
  }

  const exports = Reflect.get(manifest, 'exports');

  if (typeof exports !== 'object' || exports === null) {
    throw new TypeError(`Missing workspace export map for ${specifier}.`);
  }

  const exportDefinition = Reflect.get(exports, match?.[2] === undefined ? '.' : `./${match[2]}`);
  const importTarget = typeof exportDefinition === 'string'
    ? exportDefinition
    : typeof exportDefinition === 'object' && exportDefinition !== null
      ? Reflect.get(exportDefinition, 'import')
      : undefined;

  if (typeof importTarget !== 'string' || !importTarget.startsWith('./dist/') || !importTarget.endsWith('.js')) {
    throw new TypeError(`Missing ESM source mapping for ${specifier}.`);
  }

  return new URL(`./src/${importTarget.slice('./dist/'.length, -'.js'.length)}.ts`, packageRoot);
}

function resolveRuntimeSourceUrl(specifier: string, importer: URL): URL | undefined {
  if (specifier.startsWith('.')) {
    const sourceSpecifier = specifier.endsWith('.js')
      ? `${specifier.slice(0, -3)}.ts`
      : specifier;
    return new URL(sourceSpecifier, importer);
  }

  return specifier.startsWith('@fluojs/')
    ? resolveWorkspacePackageSourceUrl(specifier)
    : undefined;
}

function collectRuntimeDependencyGraph(entrypoint: URL) {
  const pending = [entrypoint];
  const sourceUrls = new Set<string>();
  const nodeBuiltinImports: string[] = [];

  while (pending.length > 0) {
    const sourceUrl = pending.pop();

    if (sourceUrl === undefined || sourceUrls.has(sourceUrl.href)) {
      continue;
    }

    sourceUrls.add(sourceUrl.href);
    const source = readFileSync(sourceUrl, 'utf8');

    for (const specifier of readRuntimeModuleSpecifiers(source)) {
      if (specifier.startsWith('node:')) {
        nodeBuiltinImports.push(`${sourceUrl.href}:${specifier}`);
      }

      const dependencySourceUrl = resolveRuntimeSourceUrl(specifier, sourceUrl);

      if (dependencySourceUrl) {
        pending.push(dependencySourceUrl);
      }
    }
  }

  return {
    nodeBuiltinImports,
    sourceUrls: [...sourceUrls],
  };
}

describe('@fluojs/http public API surface', () => {
  it('declares portable response cookie APIs', () => {
    expectTypeOf<CookieSameSite>().toEqualTypeOf<'lax' | 'none' | 'strict'>();
    expectTypeOf<keyof CookieOptions>().toEqualTypeOf<'domain' | 'expires' | 'httpOnly' | 'maxAgeSeconds' | 'path' | 'sameSite' | 'secure'>();
    expectTypeOf<keyof ClearCookieOptions>().toEqualTypeOf<'domain' | 'httpOnly' | 'path' | 'sameSite' | 'secure'>();
    expectTypeOf<HttpConnection['proxyChain']>().toEqualTypeOf<readonly string[]>();
  });

  it('exports only documented byte range APIs from root and portable barrels', () => {
    expectTypeOf<ByteRangeResponseOptions>().toEqualTypeOf<PortableByteRangeResponseOptions>();
    expectTypeOf<ByteRangeResponseSource>().toEqualTypeOf<PortableByteRangeResponseSource>();
    expect(httpPublicApi).toHaveProperty('createByteRangeResponse');
    expect(portableHttpPublicApi).toHaveProperty('createByteRangeResponse');
    expect(httpPublicApi).not.toHaveProperty('isByteRangeByteSource');
    expect(httpPublicApi).not.toHaveProperty('shouldApplyByteRange');
    expect(portableHttpPublicApi).not.toHaveProperty('isByteRangeByteSource');
    expect(portableHttpPublicApi).not.toHaveProperty('shouldApplyByteRange');
  });

  it('keeps documented supported root-barrel exports', () => {
    expect(httpPublicApi).toHaveProperty('Controller');
    expect(httpPublicApi).toHaveProperty('Get');
    expect(httpPublicApi).toHaveProperty('Sse');
    expect(httpPublicApi).toHaveProperty('Post');
    expect(httpPublicApi).toHaveProperty('Query');
    expect(httpPublicApi).toHaveProperty('Route');
    expect(httpPublicApi).toHaveProperty('InvalidHttpMethodError');
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
    expect(httpPublicApi).toHaveProperty('FAST_PATH_ELIGIBILITY_SYMBOL');
    expect(httpPublicApi).toHaveProperty('FAST_PATH_STATS_SYMBOL');
    expect(httpPublicApi).toHaveProperty('formatFastPathStats');
    expect(httpPublicApi).toHaveProperty('getDispatcherFastPathStats');
    expect(httpPublicApi).toHaveProperty('setCookie');
    expect(httpPublicApi).toHaveProperty('clearCookie');
    expect(httpPublicApi).toHaveProperty('createHandlerMapping');
    expect(httpPublicApi).toHaveProperty('forRoutes');
    expect(httpPublicApi).toHaveProperty('normalizeRoutePattern');
    expect(httpPublicApi).toHaveProperty('matchRoutePattern');
    expect(httpPublicApi).toHaveProperty('isMiddlewareRouteConfig');
    expect(httpPublicApi).toHaveProperty('createCorrelationMiddleware');
    expect(httpPublicApi).toHaveProperty('createCorsMiddleware');
    expect(httpPublicApi).toHaveProperty('createRateLimitMiddleware');
    expect(httpPublicApi).toHaveProperty('createAccessLogObserver');
    expect(httpPublicApi).toHaveProperty('resolveHttpConnection');
    expect(httpPublicApi).toHaveProperty('createSecurityHeadersMiddleware');
    expect(httpPublicApi).toHaveProperty('appendVaryHeader');
    expect(httpPublicApi).toHaveProperty('buildContentDisposition');
    expect(httpPublicApi).toHaveProperty('getRequestHeader');
    expect(httpPublicApi).toHaveProperty('getResponseHeader');
    expect(httpPublicApi).toHaveProperty('hasResponseHeader');
    expect(httpPublicApi).not.toHaveProperty('readFirstNonEmptyRequestHeaderValue');
    expect(httpPublicApi).toHaveProperty('SseResponse');
    expect(httpPublicApi).toHaveProperty('encodeSseComment');
    expect(httpPublicApi).toHaveProperty('encodeSseMessage');
    expect(httpPublicApi).toHaveProperty('isSseMessage');
  });

  it('keeps ResponseFormatter return bytes runtime-neutral', () => {
    const formatterReturnTypeContract: AssertTrue<
      TypeEquals<ReturnType<ResponseFormatter['format']>, string | Uint8Array>
    > = true;

    expect(formatterReturnTypeContract).toBe(true);
  });

  it('does not expose internal pipeline runners or implementation classes', () => {
    expect(httpPublicApi).not.toHaveProperty('runGuardChain');
    expect(httpPublicApi).not.toHaveProperty('runInterceptorChain');
    expect(httpPublicApi).not.toHaveProperty('runMiddlewareChain');
    expect(httpPublicApi).not.toHaveProperty('DefaultConverter');
    expect(httpPublicApi).not.toHaveProperty('DefaultBinder');
    expect(httpPublicApi).not.toHaveProperty('getRouteProducesMetadata');
  });

  it('keeps root-barrel request helpers free of eager Node built-in imports', () => {
    const correlationSource = readFileSync(new URL('./middleware/correlation.ts', import.meta.url), 'utf8');
    const requestContextSource = readFileSync(new URL('./context/request-context.ts', import.meta.url), 'utf8');

    expect(correlationSource).not.toContain("from 'node:crypto'");
    expect(requestContextSource).not.toContain("from 'node:async_hooks'");
  });

  it('reads static dynamic-import templates without treating interpolated templates as dependencies', () => {
    // Given
    const source = [
      "void import(`node:async_hooks`);",
      `void import(\`@fluojs/\${packageName}\`);`,
    ].join('\n');

    // When
    const specifiers = readRuntimeModuleSpecifiers(source);

    // Then
    expect(specifiers).toEqual(['node:async_hooks']);
  });

  it('keeps every reachable portable entrypoint module free of Node built-in import specifiers', () => {
    // Given
    const portableEntrypoint = new URL('./index.portable.ts', import.meta.url);

    // When
    const graph = collectRuntimeDependencyGraph(portableEntrypoint);

    // Then
    expect(graph.sourceUrls).toContain(new URL('./context/request-context-node-store.ts', import.meta.url).href);
    expect(graph.sourceUrls).toContain(new URL('../../core/src/index.ts', import.meta.url).href);
    expect(graph.sourceUrls).toContain(new URL('../../validation/src/index.ts', import.meta.url).href);
    expect(graph.nodeBuiltinImports).toEqual([]);
  });

  it('keeps the internal subpath limited to the documented exported helpers', () => {
    // Given
    const exportedHelpers = Object.keys(httpInternalApi).sort();

    // When
    const compiledRouteIdentityReader = httpInternalApi.getCompiledRouteIdentity;

    // Then
    expect(httpInternalApi).toHaveProperty('DefaultBinder');
    expect(httpInternalApi).toHaveProperty('FRAMEWORK_RESPONSE_VALUE_FINALIZER');
    expect(httpInternalApi).toHaveProperty('FRAMEWORK_RESPONSE_WRITER');
    expect(httpInternalApi).toHaveProperty('resolveClientIdentity');
    expect(compiledRouteIdentityReader).toEqual(expect.any(Function));
    expect(exportedHelpers).toEqual([
      'DefaultBinder',
      'FRAMEWORK_RESPONSE_VALUE_FINALIZER',
      'FRAMEWORK_RESPONSE_WRITER',
      'attachFrameworkRequestNativeRouteHandoff',
      'bindRawRequestNativeRouteHandoff',
      'consumeRawRequestNativeRouteHandoff',
      'createFetchStyleHttpAdapterRealtimeCapability',
      'getCompiledRouteIdentity',
      'isRoutePathNormalizationSensitive',
      'readFrameworkRequestNativeRouteHandoff',
      'registerFrameworkResponseValueFinalizer',
      'registerFrameworkResponseWriter',
      'resolveClientIdentity',
    ]);
  });

  it('shares typed response integration keys and non-enumerable writer branding', async () => {
    // Given: an integration-owned response entry and request-local metadata.
    const entry = {};
    const metadata: Record<symbol, unknown> = {};
    const writer = (): void => {};
    const firstFinalizer = ({ value }: { readonly value: unknown }): unknown => `${String(value)}:first`;
    const secondFinalizer = async ({ value }: { readonly value: unknown }): Promise<unknown> => `${String(value)}:second`;

    // When: integrations register a writer and ordered synchronous/asynchronous finalizers.
    httpInternalApi.registerFrameworkResponseWriter(entry, writer);
    httpInternalApi.registerFrameworkResponseValueFinalizer({ metadata }, firstFinalizer);
    httpInternalApi.registerFrameworkResponseValueFinalizer({ metadata }, secondFinalizer);
    const composedFinalizer = metadata[httpInternalApi.FRAMEWORK_RESPONSE_VALUE_FINALIZER];

    // Then: consumers share one globally stable protocol without exposing writer brands in output.
    expect(httpInternalApi.FRAMEWORK_RESPONSE_WRITER).toBe(Symbol.for('fluo.http.responseWriter'));
    expect(httpInternalApi.FRAMEWORK_RESPONSE_VALUE_FINALIZER).toBe(Symbol.for('fluo.http.responseValueFinalizer'));
    expect(Reflect.get(entry, httpInternalApi.FRAMEWORK_RESPONSE_WRITER)).toBe(writer);
    expect(Object.keys(entry)).toEqual([]);
    expect(composedFinalizer).toEqual(expect.any(Function));

    if (typeof composedFinalizer !== 'function') {
      throw new TypeError('Expected a composed response value finalizer.');
    }

    await expect(composedFinalizer({ value: 'initial' })).resolves.toBe('initial:first:second');
  });
});
