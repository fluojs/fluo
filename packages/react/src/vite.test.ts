import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createReactViteAssetManifest } from './vite.js';

const viteManifest = {
  'src/entry-client.tsx': {
    assets: ['assets/logo.123.svg'],
    css: ['assets/client.123.css'],
    file: 'assets/client.123.js',
    imports: ['_vendor.js', '_theme.js'],
    isEntry: true,
    src: 'src/entry-client.tsx',
  },
  'src/entry-server.tsx': {
    file: 'assets/server.123.js',
    isEntry: true,
    src: 'src/entry-server.tsx',
  },
  '_theme.js': {
    css: ['assets/theme.123.css', 'assets/vendor.123.css'],
    file: 'assets/theme.123.js',
    imports: ['_vendor.js'],
  },
  '_vendor.js': {
    css: ['assets/vendor.123.css'],
    file: 'assets/vendor.123.js',
  },
} satisfies Record<string, unknown>;

describe('@fluojs/react/vite asset manifest integration', () => {
  it('derives one identity from the entire manifest and same-origin base', () => {
    // Given: two independent outputs differ only in a lazy chunk.
    const build = (manifest: unknown, base = '/assets/') => createReactViteAssetManifest({
      base,
      entries: { client: 'src/entry-client.tsx', server: 'src/entry-server.tsx' },
      manifest,
    });
    const first = build(viteManifest);
    const changed = build({
      ...viteManifest,
      'src/navigation-product.ts': { file: 'assets/product.b.js', isDynamicEntry: true },
    });
    const originalWithLazy = build({
      ...viteManifest,
      'src/navigation-product.ts': { file: 'assets/product.a.js', isDynamicEntry: true },
    });
    const otherBase = build(viteManifest, '/different/');

    // When/Then: lazy outputs and the public base contribute to the server/browser identity.
    expect(first.ok && originalWithLazy.ok && changed.ok && otherBase.ok).toBe(true);
    if (!first.ok || !originalWithLazy.ok || !changed.ok || !otherBase.ok) return;
    expect(first.manifest.buildId).toMatch(/^[a-f0-9]{64}$/u);
    expect(originalWithLazy.manifest.buildId).not.toBe(changed.manifest.buildId);
    expect(first.manifest.buildId).not.toBe(otherBase.manifest.buildId);
  });

  it('includes the complete Vite manifest without depending on key order', () => {
    const build = (manifest: unknown) => createReactViteAssetManifest({
      base: '/assets/',
      entries: { client: 'src/entry-client.tsx', server: 'src/entry-server.tsx' },
      manifest,
    });
    const original = build(viteManifest);
    const reordered = build(Object.fromEntries(Object.entries(viteManifest).reverse()));
    const changedDynamicImports = build({
      ...viteManifest,
      'src/entry-client.tsx': {
        ...viteManifest['src/entry-client.tsx'],
        dynamicImports: ['src/navigation-extra.tsx'],
      },
    });
    expect(original.ok && reordered.ok && changedDynamicImports.ok).toBe(true);
    if (!original.ok || !reordered.ok || !changedDynamicImports.ok) return;
    expect(reordered.manifest.buildId).toBe(original.manifest.buildId);
    expect(changedDynamicImports.manifest.buildId).not.toBe(original.manifest.buildId);
  });

  it('parses Vite client/server entries into deterministic hydration assets', () => {
    // Given: a Vite client manifest with nested JS imports, CSS, assets, and bootstrap metadata.
    const result = createReactViteAssetManifest({
      base: '/static/',
      bootstrapScriptContent: 'window.__FLUO_BOOTSTRAP__ = {"route":"dashboard"};',
      bootstrapScripts: [{ integrity: 'sha384-classic', src: '/classic-runtime.js' }],
      entries: {
        client: 'src/entry-client.tsx',
        server: 'src/entry-server.tsx',
      },
      identifierPrefix: 'fluo-',
      manifest: viteManifest,
      nonce: 'nonce-123',
    });

    // When: the manifest is accepted.
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    // Then: CSS and JS order follows the import graph before the client entry.
    expect(result.manifest.css).toEqual([
      '/static/assets/vendor.123.css',
      '/static/assets/theme.123.css',
      '/static/assets/client.123.css',
    ]);
    expect(result.manifest.js.modules).toEqual([
      '/static/assets/vendor.123.js',
      '/static/assets/theme.123.js',
      '/static/assets/client.123.js',
    ]);
    expect(result.manifest.js.scripts).toEqual([
      { integrity: 'sha384-classic', src: '/classic-runtime.js' },
    ]);
    expect(result.manifest.hydrationOptions).toEqual({
      assetMap: {
        '_theme.js': '/static/assets/theme.123.js',
        '_vendor.js': '/static/assets/vendor.123.js',
        'assets/client.123.css': '/static/assets/client.123.css',
        'assets/client.123.js': '/static/assets/client.123.js',
        'assets/logo.123.svg': '/static/assets/logo.123.svg',
        'assets/server.123.js': '/static/assets/server.123.js',
        'assets/theme.123.css': '/static/assets/theme.123.css',
        'assets/theme.123.js': '/static/assets/theme.123.js',
        'assets/vendor.123.css': '/static/assets/vendor.123.css',
        'assets/vendor.123.js': '/static/assets/vendor.123.js',
        'src/entry-client.tsx': '/static/assets/client.123.js',
        'src/entry-server.tsx': '/static/assets/server.123.js',
      },
      bootstrapModules: [
        '/static/assets/vendor.123.js',
        '/static/assets/theme.123.js',
        '/static/assets/client.123.js',
      ],
      bootstrapScriptContent: 'window.__FLUO_BOOTSTRAP__ = {"route":"dashboard"};',
      bootstrapScripts: [{ integrity: 'sha384-classic', src: '/classic-runtime.js' }],
      identifierPrefix: 'fluo-',
      nonce: 'nonce-123',
    });
  });

  it('reports missing server and client entries with explicit diagnostics', () => {
    // Given: a manifest that does not contain either requested React entry.
    const result = createReactViteAssetManifest({
      entries: {
        client: 'src/missing-client.tsx',
        server: 'src/missing-server.tsx',
      },
      manifest: viteManifest,
    });

    // When/Then: both missing entries are reported without throwing.
    expect(result).toEqual({
      diagnostics: [
        {
          code: 'react-vite-manifest-missing-server-entry',
          entry: 'src/missing-server.tsx',
          message: 'React Vite server entry "src/missing-server.tsx" was not found in the manifest.',
        },
        {
          code: 'react-vite-manifest-missing-client-entry',
          entry: 'src/missing-client.tsx',
          message: 'React Vite client entry "src/missing-client.tsx" was not found in the manifest.',
        },
      ],
      ok: false,
    });
  });

  it('preserves relative manifest URLs when Vite base is explicitly empty', () => {
    // Given: a Vite manifest from a relative-base deployment.
    const result = createReactViteAssetManifest({
      base: '',
      entries: {
        client: 'src/entry-client.tsx',
        server: 'src/entry-server.tsx',
      },
      manifest: viteManifest,
    });

    // When: the manifest is accepted.
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    // Then: explicit empty base keeps relative files relative instead of root-relative.
    expect(result.manifest.css).toEqual([
      'assets/vendor.123.css',
      'assets/theme.123.css',
      'assets/client.123.css',
    ]);
    expect(result.manifest.js.modules).toEqual([
      'assets/vendor.123.js',
      'assets/theme.123.js',
      'assets/client.123.js',
    ]);
    expect(result.manifest.assetMap['src/entry-client.tsx']).toBe('assets/client.123.js');
    expect(result.manifest.hydrationOptions.bootstrapModules).toEqual([
      'assets/vendor.123.js',
      'assets/theme.123.js',
      'assets/client.123.js',
    ]);
  });

  it('reports malformed manifests and unsupported output shapes', () => {
    // Given: malformed entry fields and a CSS-only client output shape.
    const malformedResult = createReactViteAssetManifest({
      entries: {
        client: 'src/entry-client.tsx',
        server: 'src/entry-server.tsx',
      },
      manifest: {
        'src/entry-client.tsx': {
          css: ['assets/client.css', 42],
          file: 'assets/client.js',
        },
        'src/entry-server.tsx': {
          file: 'assets/server.js',
        },
      },
    });
    const unsupportedResult = createReactViteAssetManifest({
      entries: {
        client: 'src/entry-client.tsx',
        server: 'src/entry-server.tsx',
      },
      manifest: {
        'src/entry-client.tsx': {
          file: 'assets/client.css',
        },
        'src/entry-server.tsx': {
          file: 'assets/server.js',
        },
      },
    });

    // When/Then: malformed schema and unsupported Vite output are classified separately.
    expect(malformedResult).toEqual({
      diagnostics: [
        {
          code: 'react-vite-manifest-malformed',
          message: 'React Vite manifest entry "src/entry-client.tsx" field "css" must be an array of strings.',
          path: 'src/entry-client.tsx.css',
        },
      ],
      ok: false,
    });
    expect(unsupportedResult).toEqual({
      diagnostics: [
        {
          code: 'react-vite-manifest-unsupported-output-shape',
          entry: 'src/entry-client.tsx',
          message: 'React Vite client entry "src/entry-client.tsx" must resolve to a JavaScript output file, received "assets/client.css".',
        },
      ],
      ok: false,
    });
  });

  it('keeps the Vite subpath out of the root import boundary', () => {
    // Given: root source and package export metadata.
    const rootEntrypoint = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const packageManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    // When/Then: the package exposes @fluojs/react/vite without wiring it through the root barrel.
    expect(packageManifest).toContain('"./vite"');
    expect(rootEntrypoint).not.toContain('./vite.js');
    expect(rootEntrypoint).not.toContain("from 'vite'");
  });
});
