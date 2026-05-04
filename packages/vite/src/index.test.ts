import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';

import { fluoDecoratorsPlugin } from './index.js';

function getTransform(plugin: Plugin): Extract<Plugin['transform'], (...args: never[]) => unknown> {
  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable transform hook.');
  }

  return plugin.transform as Extract<Plugin['transform'], (...args: never[]) => unknown>;
}

describe('fluoDecoratorsPlugin', () => {
  it('skips generated test files', async () => {
    const plugin = fluoDecoratorsPlugin();
    const transform = getTransform(plugin);

    await expect(transform.call({} as never, 'export const value: number = 1;', '/app/src/app.test.ts')).resolves.toBeNull();
  });

  it('transforms TypeScript files with standard decorators through Babel', async () => {
    const plugin = fluoDecoratorsPlugin();
    const transform = getTransform(plugin);
    const result = await transform.call(
      {} as never,
      `function logged(value: unknown, context: ClassMethodDecoratorContext) {
  context.name;
}

class Example {
  @logged
  greet(): string {
    return 'hello';
  }
}

export { Example };
`,
      '/app/src/example.ts',
    );

    expect(result).toEqual(expect.objectContaining({ code: expect.any(String) }));
    expect(result && typeof result === 'object' && 'code' in result ? result.code : '').not.toContain(': string');
  });
});
