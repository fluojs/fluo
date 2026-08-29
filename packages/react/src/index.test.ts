import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

const runtimeStaticModuleSpecifierPattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

const forbiddenRootImports = [
  ['node:fs/promises', 'Node filesystem'],
  ['node:http', 'Node HTTP'],
  ['vite', 'Vite'],
  ['react-dom/server', 'React DOM server'],
  ['react-server-dom-webpack/server', 'React Server Components server'],
] as const;

function readStaticModuleSpecifiers(source: string): string[] {
  return [...source.matchAll(runtimeStaticModuleSpecifierPattern)].flatMap((match) => {
    const specifier = match[1];
    return specifier === undefined ? [] : [specifier];
  });
}

function resolveWorkspaceBuildUrl(specifier: string): URL | undefined {
  const match = /^@fluojs\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  const packageName = match?.[1];

  if (packageName === undefined) {
    return undefined;
  }

  const packageRoot = new URL(`../../${packageName}/`, import.meta.url);
  const manifest: unknown = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'));
  const exports = typeof manifest === 'object' && manifest !== null
    ? Reflect.get(manifest, 'exports')
    : undefined;
  const exportDefinition = typeof exports === 'object' && exports !== null
    ? Reflect.get(exports, match?.[2] === undefined ? '.' : `./${match[2]}`)
    : undefined;
  const nodeTarget = typeof exportDefinition === 'object' && exportDefinition !== null
    ? Reflect.get(exportDefinition, 'node')
    : undefined;
  const importTarget = typeof exportDefinition === 'string'
    ? exportDefinition
    : typeof exportDefinition === 'object' && exportDefinition !== null
      ? Reflect.get(exportDefinition, 'import')
      : undefined;
  const target = typeof nodeTarget === 'string' ? nodeTarget : importTarget;

  if (typeof target !== 'string' || !target.startsWith('./dist/') || !target.endsWith('.js')) {
    throw new TypeError(`Missing Node ESM build mapping for ${specifier}.`);
  }

  return new URL(target, packageRoot);
}

function resolveBuiltModuleUrl(specifier: string, importer: URL): URL | undefined {
  if (specifier.startsWith('.')) {
    return new URL(specifier, importer);
  }

  return specifier.startsWith('@fluojs/')
    ? resolveWorkspaceBuildUrl(specifier)
    : undefined;
}

function collectBuiltNodeDependencyGraph(entrypoint: URL): string[] {
  const pending = [entrypoint];
  const visited = new Set<string>();
  const nodeImports: string[] = [];

  while (pending.length > 0) {
    const sourceUrl = pending.pop();

    if (sourceUrl === undefined || visited.has(sourceUrl.href)) {
      continue;
    }

    visited.add(sourceUrl.href);
    const source = readFileSync(sourceUrl, 'utf8');

    for (const specifier of readStaticModuleSpecifiers(source)) {
      if (specifier.startsWith('node:')) {
        nodeImports.push(`${sourceUrl.href}:${specifier}`);
      }

      const dependencyUrl = resolveBuiltModuleUrl(specifier, sourceUrl);

      if (dependencyUrl !== undefined) {
        pending.push(dependencyUrl);
      }
    }
  }

  return nodeImports;
}

describe('@fluojs/react root package scaffold', () => {
  it('exposes the implemented runtime React package exports from the root import', async () => {
    const react = await import('./index.js');

    expect(Object.keys(react).sort()).toEqual([
      'PageLayout',
      'PageMetadata',
      'Path',
      'REACT_PAGE_RENDERER',
      'REACT_RENDER_POLICY_DIAGNOSTIC_CODES',
      'REACT_SSR_DIAGNOSTIC_CODES',
      'REACT_SSR_DIAGNOSTIC_PHASES',
      'ReactModule',
      'ReactRenderPolicyConfigurationError',
      'ReactSsrDiagnosticError',
      'Router',
      'SuspenseFallback',
      'createReactErrorRepresentationProvider',
      'createReactPageCatalog',
      'createReactPageMetadataElements',
      'createReactServerEntry',
      'getReactPathMetadata',
      'getReactRenderPolicies',
      'getReactRouterMetadata',
      'renderReactResponse',
      'resolveReactPageMetadata',
    ]);
  });

  it('does not load Node, Vite, SSR, or RSC modules from the root import', async () => {
    vi.resetModules();

    for (const [moduleId, label] of forbiddenRootImports) {
      vi.doMock(moduleId, () => {
        throw new Error(`${label} should not load from the @fluojs/react root import.`);
      });
    }

    try {
      const react = await import('./index.js');

      expect(react).toHaveProperty('Path');
      expect(react).toHaveProperty('PageLayout');
      expect(react).toHaveProperty('PageMetadata');
      expect(react).toHaveProperty('ReactModule');
      expect(react).toHaveProperty('REACT_PAGE_RENDERER');
      expect(react).toHaveProperty('Router');
      expect(react).toHaveProperty('SuspenseFallback');
      expect(react).toHaveProperty('createReactErrorRepresentationProvider');
      expect(react).toHaveProperty('createReactPageCatalog');
      expect(react).toHaveProperty('createReactPageMetadataElements');
      expect(react).toHaveProperty('createReactServerEntry');
      expect(react).toHaveProperty('renderReactResponse');
      expect(react).toHaveProperty('resolveReactPageMetadata');
    } finally {
      for (const [moduleId] of forbiddenRootImports) {
        vi.doUnmock(moduleId);
      }
      vi.resetModules();
    }
  });

  it('keeps SSR exports on the lazy Web Streams boundary without root-only runtime imports', () => {
    const rootEntrypoint = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const renderEntrypoint = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');

    expect(rootEntrypoint).toContain("from './module.js'");
    expect(rootEntrypoint).toContain("from './page-renderer.js'");
    expect(rootEntrypoint).toContain("from './page-metadata.js'");
    expect(rootEntrypoint).toContain("from './render-policy.js'");
    expect(rootEntrypoint).toContain("from './decorators.js'");
    expect(rootEntrypoint).toContain("from './diagnostics.js'");
    expect(rootEntrypoint).toContain("from './error-representation.js'");
    expect(rootEntrypoint).toContain("from './server-entry.js'");
    expect(rootEntrypoint).toContain("from './render.js'");
    expect(rootEntrypoint).not.toContain('react-dom/server');
    expect(renderEntrypoint).toContain("import('react-dom/server')");
    expect(renderEntrypoint).not.toContain("from 'react-dom/server'");
    expect(rootEntrypoint).not.toContain('./vite.js');
    expect(rootEntrypoint).not.toContain('./client.js');
    expect(rootEntrypoint).not.toContain('./rsc.js');
  });

  it('keeps every eagerly reachable built root dependency free of Node built-ins', () => {
    // Given: the built package root as resolved by Node's conditional exports.
    const rootEntrypoint = new URL('../dist/index.js', import.meta.url);

    // When: eager static dependencies are followed through workspace export maps.
    const nodeImports = collectBuiltNodeDependencyGraph(rootEntrypoint);

    // Then: runtime-neutral React authoring contracts never initialize Node bootstrap code.
    expect(nodeImports).toEqual([]);
  });
});
