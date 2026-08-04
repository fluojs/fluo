import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

const forbiddenRootImports = [
  ['node:fs/promises', 'Node filesystem'],
  ['node:http', 'Node HTTP'],
  ['vite', 'Vite'],
  ['react-dom/server', 'React DOM server'],
  ['react-server-dom-webpack/server', 'React Server Components server'],
] as const;

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
});
