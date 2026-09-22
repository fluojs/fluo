import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { describe, expect, it } from 'vitest';
import { readTransformedCode, runDecoratorsTransform } from './run-transform';

/**
 * @fluojs/vite guide evidence: the plugin identity, the application/test
 * transform boundaries, lazy metadata-preload injection for decorated
 * modules, and the skipped file classes.
 */

const DECORATED_APP = [
  "import { Inject } from '@fluojs/core';",
  '',
  'class Service {}',
  '',
  '@Inject(Service)',
  'export class Consumer {',
  '  constructor(private readonly service: Service) {}',
  '}',
  '',
].join('\n');

const PLAIN_APP = 'export const value: number = 1;\n';

describe('@fluojs/vite guide examples', () => {
  it('registers the decorator transform in the pre stage', () => {
    const plugin = fluoDecoratorsPlugin();

    expect(plugin.name).toBe('fluo-babel-decorators');
    expect(plugin.enforce).toBe('pre');
  });

  it('transforms decorated application modules and injects the metadata preload', async () => {
    const plugin = fluoDecoratorsPlugin();
    const result = await runDecoratorsTransform(plugin, DECORATED_APP, '/proj/src/app.ts');

    const code = readTransformedCode(result);
    expect(code).toContain("@fluojs/core/metadata-preload");
    expect(code).not.toContain('@Inject(');
  });

  it('leaves decorator-free modules without the preload import', async () => {
    const plugin = fluoDecoratorsPlugin();
    const result = await runDecoratorsTransform(plugin, PLAIN_APP, '/proj/src/plain.ts');

    const code = readTransformedCode(result);
    expect(code).not.toContain('@fluojs/core/metadata-preload');
  });

  it.each([
    '/proj/src/app.test.ts',
    '/proj/src/app.d.ts',
    '/proj/node_modules/pkg/src/mod.ts',
    '/proj/src/plain.js',
  ])('skips %s in application mode', async (id) => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runDecoratorsTransform(plugin, DECORATED_APP, id)).resolves.toBeNull();
  });

  it('includes test modules under the test boundary while skipping declarations', async () => {
    const plugin = fluoDecoratorsPlugin({ transformBoundary: 'test' });

    const transformed = await runDecoratorsTransform(plugin, DECORATED_APP, '/proj/src/app.slice.test.ts');
    expect(readTransformedCode(transformed)).toContain('@fluojs/core/metadata-preload');

    await expect(runDecoratorsTransform(plugin, DECORATED_APP, '/proj/src/app.d.ts')).resolves.toBeNull();
  });
});
