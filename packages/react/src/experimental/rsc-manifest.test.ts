import { describe, expect, it } from 'vitest';

import { createReactRscManifest } from './rsc-manifest.js';
import { REACT_RSC_DIAGNOSTIC_CODES } from './rsc-types.js';

describe('experimental RSC manifest seam', () => {
  it('creates a defensive client-reference and server-client module mapping snapshot', () => {
    // Given: an application build adapter produced one client reference and one server mapping.
    const chunks = ['assets/counter.js'];
    const clientReferences = {
      Counter: {
        chunks,
        id: 'client:counter',
        name: 'Counter',
      },
    };
    const serverClientModuleMap = {
      'server:dashboard': {
        Counter: 'Counter',
      },
    };

    // When: the experimental manifest seam snapshots the build output.
    const result = createReactRscManifest({ clientReferences, serverClientModuleMap });
    chunks.push('assets/mutated.js');
    clientReferences.Counter.name = 'MutatedCounter';
    serverClientModuleMap['server:dashboard'].Counter = 'Missing';

    // Then: the returned manifest remains detached from caller-owned build objects.
    expect(result).toEqual({
      diagnostics: [],
      manifest: {
        clientReferences: {
          Counter: {
            chunks: ['assets/counter.js'],
            id: 'client:counter',
            name: 'Counter',
          },
        },
        serverClientModuleMap: {
          'server:dashboard': {
            Counter: 'Counter',
          },
        },
      },
      ok: true,
    });
  });

  it('rejects server-client mappings that target an unknown client reference', () => {
    // Given: a server module mapping points at a missing client-reference key.
    const input = {
      clientReferences: {
        Counter: {
          chunks: ['assets/counter.js'],
          id: 'client:counter',
          name: 'Counter',
        },
      },
      serverClientModuleMap: {
        'server:dashboard': {
          Counter: 'MissingCounter',
        },
      },
    } as const;

    // When: the manifest is created.
    const result = createReactRscManifest(input);

    // Then: the invalid build mapping is reported instead of accepted.
    expect(result).toEqual({
      diagnostics: [
        {
          code: REACT_RSC_DIAGNOSTIC_CODES.unknownClientReference,
          message: 'Server module "server:dashboard" export "Counter" maps to unknown client reference "MissingCounter".',
          path: 'serverClientModuleMap.server:dashboard.Counter',
        },
      ],
      ok: false,
    });
  });
});
