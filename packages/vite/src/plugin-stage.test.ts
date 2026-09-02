import { describe, expect, it } from 'vitest';

import { createFluoDecoratorsPluginForTesting } from './decorators-plugin.js';
import { fluoDecoratorsPlugin } from './index.js';

function rejectBabelLoad(): Promise<never> {
  return Promise.reject(new Error('Babel must not load while inspecting the plugin stage.'));
}

describe('fluoDecoratorsPlugin plugin stage', () => {
  it('runs before the Vite transpiler so field decorators still reach Babel', () => {
    expect(fluoDecoratorsPlugin().enforce).toBe('pre');
  });

  it('keeps the pre-transpiler stage on the injected-Babel test factory', () => {
    expect(createFluoDecoratorsPluginForTesting(rejectBabelLoad).enforce).toBe('pre');
  });
});
