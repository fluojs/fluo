import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ResponseFormatter } from './index.js';
import * as httpPublicApi from './index.js';
import * as httpInternalApi from './internal.js';

type TypeEquals<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2)
  ? (<Value>() => Value extends Right ? 1 : 2) extends (<Value>() => Value extends Left ? 1 : 2)
    ? true
    : false
  : false;

type AssertTrue<Condition extends true> = Condition;

const runtimeStaticModuleSpecifierPattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const runtimeDynamicModuleSpecifierPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function readRuntimeModuleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(runtimeStaticModuleSpecifierPattern),
    ...source.matchAll(runtimeDynamicModuleSpecifierPattern),
  ].flatMap((match) => {
    const specifier = match[1];
    return specifier === undefined ? [] : [specifier];
  });
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

      if (specifier.startsWith('.')) {
        const sourceSpecifier = specifier.endsWith('.js')
          ? `${specifier.slice(0, -3)}.ts`
          : specifier;
        pending.push(new URL(sourceSpecifier, sourceUrl));
      }
    }
  }

  return {
    nodeBuiltinImports,
    sourceUrls: [...sourceUrls],
  };
}

describe('@fluojs/http public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(httpPublicApi).toHaveProperty('Controller');
    expect(httpPublicApi).toHaveProperty('Get');
    expect(httpPublicApi).toHaveProperty('Sse');
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
    expect(httpPublicApi).toHaveProperty('FAST_PATH_ELIGIBILITY_SYMBOL');
    expect(httpPublicApi).toHaveProperty('FAST_PATH_STATS_SYMBOL');
    expect(httpPublicApi).toHaveProperty('formatFastPathStats');
    expect(httpPublicApi).toHaveProperty('getDispatcherFastPathStats');
    expect(httpPublicApi).toHaveProperty('createHandlerMapping');
    expect(httpPublicApi).toHaveProperty('forRoutes');
    expect(httpPublicApi).toHaveProperty('normalizeRoutePattern');
    expect(httpPublicApi).toHaveProperty('matchRoutePattern');
    expect(httpPublicApi).toHaveProperty('isMiddlewareRouteConfig');
    expect(httpPublicApi).toHaveProperty('createCorrelationMiddleware');
    expect(httpPublicApi).toHaveProperty('createCorsMiddleware');
    expect(httpPublicApi).toHaveProperty('createRateLimitMiddleware');
    expect(httpPublicApi).toHaveProperty('createSecurityHeadersMiddleware');
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

  it('keeps every reachable portable entrypoint module free of Node built-in import specifiers', () => {
    // Given
    const portableEntrypoint = new URL('./index.portable.ts', import.meta.url);

    // When
    const graph = collectRuntimeDependencyGraph(portableEntrypoint);

    // Then
    expect(graph.sourceUrls).toContain(new URL('./context/request-context-node-store.ts', import.meta.url).href);
    expect(graph.nodeBuiltinImports).toEqual([]);
  });

  it('keeps the internal subpath limited to the documented exported helpers', () => {
    expect(httpInternalApi).toHaveProperty('DefaultBinder');
    expect(httpInternalApi).toHaveProperty('resolveClientIdentity');
    expect(Object.keys(httpInternalApi).sort()).toEqual([
      'DefaultBinder',
      'attachFrameworkRequestNativeRouteHandoff',
      'bindRawRequestNativeRouteHandoff',
      'consumeRawRequestNativeRouteHandoff',
      'createFetchStyleHttpAdapterRealtimeCapability',
      'isRoutePathNormalizationSensitive',
      'readFrameworkRequestNativeRouteHandoff',
      'resolveClientIdentity',
    ]);
  });
});
