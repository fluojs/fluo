import { describe, expect, it } from 'vitest';

import * as runtimeApi from './index.js';
import type { LifecycleHooks } from './types.js';

function acceptLifecycleHook(_hook: LifecycleHooks): void {}

describe('runtime public surface', () => {
  it('keeps the documented runtime facade alias on the root barrel', () => {
    expect(runtimeApi.fluoFactory).toBe(runtimeApi.FluoFactory);
  });

  it('exports the documented LifecycleHooks convenience type', () => {
    acceptLifecycleHook({
      onModuleInit() {},
    });
  });
});
