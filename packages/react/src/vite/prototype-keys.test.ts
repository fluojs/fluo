import { describe, expect, it } from 'vitest';

import { createReactServerEntry } from '../server-entry.js';
import { createReactViteAssetManifest } from '../vite.js';

const baseManifest = {
  client: {
    file: 'assets/client.js',
  },
  server: {
    file: 'assets/server.js',
  },
} satisfies Record<string, unknown>;

describe('@fluojs/react/vite prototype-key handling', () => {
  it('reports missing entries when selectors name inherited Object prototype keys', () => {
    // Given: selectors that are inherited by ordinary JavaScript objects but absent from the manifest.
    const createManifest = () =>
      createReactViteAssetManifest({
        entries: {
          client: 'toString',
          server: 'constructor',
        },
        manifest: baseManifest,
      });

    // When/Then: inherited members are not treated as parsed entries and the API does not throw.
    expect(createManifest).not.toThrow();
    expect(createManifest()).toEqual({
      diagnostics: [
        {
          code: 'react-vite-manifest-missing-server-entry',
          entry: 'constructor',
          message: 'React Vite server entry "constructor" was not found in the manifest.',
        },
        {
          code: 'react-vite-manifest-missing-client-entry',
          entry: 'toString',
          message: 'React Vite client entry "toString" was not found in the manifest.',
        },
      ],
      ok: false,
    });
  });

  it('reports a missing imported chunk when its id names an inherited Object prototype key', () => {
    // Given: a valid client entry whose imports contain no own manifest entry named "toString".
    const createManifest = () =>
      createReactViteAssetManifest({
        entries: {
          client: 'client',
          server: 'server',
        },
        manifest: {
          ...baseManifest,
          client: {
            file: 'assets/client.js',
            imports: ['toString'],
          },
        },
      });

    // When/Then: graph traversal returns a malformed-manifest diagnostic instead of throwing.
    expect(createManifest).not.toThrow();
    expect(createManifest()).toEqual({
      diagnostics: [
        {
          code: 'react-vite-manifest-malformed',
          message: 'React Vite manifest entry "client" imports missing chunk "toString".',
          path: 'client.imports',
        },
      ],
      ok: false,
    });
  });

  it('preserves own prototype-named chunks and __proto__ asset mappings', () => {
    // Given: own "constructor" and "__proto__" dependencies plus an asset named "__proto__".
    const result = createReactViteAssetManifest({
      entries: {
        client: 'client',
        server: 'server',
      },
      manifest: {
        ...baseManifest,
        client: {
          assets: ['__proto__'],
          file: 'assets/client.js',
          imports: ['constructor', '__proto__'],
        },
        constructor: {
          file: 'assets/vendor.js',
        },
        ['__proto__']: {
          file: 'assets/proto.js',
        },
      },
    });

    // When: the manifest is parsed successfully.
    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    // Then: own prototype-named keys remain data properties with deterministic URLs.
    expect(result.manifest.js.modules).toEqual([
      '/assets/vendor.js',
      '/assets/proto.js',
      '/assets/client.js',
    ]);
    expect(Object.hasOwn(result.manifest.assetMap, 'constructor')).toBe(true);
    expect(result.manifest.assetMap['constructor']).toBe('/assets/vendor.js');
    expect(Object.hasOwn(result.manifest.assetMap, '__proto__')).toBe(true);
    expect(result.manifest.assetMap['__proto__']).toBe('/assets/proto.js');

    const serverEntry = createReactServerEntry(null, {
      assetMap: result.manifest.assetMap,
    });
    expect(Object.hasOwn(serverEntry.assetMap, '__proto__')).toBe(true);
    expect(serverEntry.assetMap['__proto__']).toBe('/assets/proto.js');
  });
});
