import { describe, expect, it } from 'vitest';

import * as runtimeApi from './index.js';
import type { LifecycleHooks } from './types.js';

function acceptLifecycleHook(_hook: LifecycleHooks): void {}

describe('runtime public surface', () => {
  it('exposes only the canonical static HTTP creation entrypoint', () => {
    expect(runtimeApi.FluoFactory.create).toBeTypeOf('function');
    expect(runtimeApi).not.toHaveProperty('fluoFactory');
    expect(runtimeApi).not.toHaveProperty('bootstrapApplication');
  });

  it('exports the documented LifecycleHooks convenience type', () => {
    acceptLifecycleHook({
      onModuleInit() {},
    });
  });
});
