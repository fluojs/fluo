import type { OnModuleDestroy } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { DefaultJwtVerifier } from './signing/verifier.js';
import type { JwtModuleDestroyLifecycle } from './signing/verifier.js';

describe('DefaultJwtVerifier lifecycle contract', () => {
  it('remains bidirectionally compatible with the runtime destruction lifecycle', () => {
    const runtimeLifecycle: OnModuleDestroy = {
      async onModuleDestroy(): Promise<void> {},
    };
    const jwtLifecycle: JwtModuleDestroyLifecycle = runtimeLifecycle;
    const restoredRuntimeLifecycle: OnModuleDestroy = jwtLifecycle;

    expect(restoredRuntimeLifecycle).toBe(runtimeLifecycle);
  });

  it('implements the compatible lifecycle through DefaultJwtVerifier', () => {
    const verifier = new DefaultJwtVerifier({
      algorithms: ['HS256'],
      secret: 'secret',
    });
    const lifecycle: OnModuleDestroy = verifier;

    expect(lifecycle).toBe(verifier);
  });
});
