import type { OnModuleDestroy } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { DefaultJwtVerifier } from './signing/verifier.js';

describe('DefaultJwtVerifier lifecycle contract', () => {
  it('remains structurally assignable to the runtime destruction lifecycle', () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const lifecycle: OnModuleDestroy = verifier;

    expect(lifecycle).toBe(verifier);
  });
});
