import { describe, expect, it } from 'vitest';

import { fluoDecoratorsPlugin } from './index.js';

describe('fluoDecoratorsPlugin source map preservation', () => {
  it('preserves source map contents for decorated application modules', async () => {
    // Given: a decorated module and a consumer requesting source maps.
    const source = `function Field(_value: unknown, context: ClassFieldDecoratorContext) {
  context.name;
}
class ProfileDto {
  @Field
  name = '';
}
`;
    const plugin = fluoDecoratorsPlugin({ sourceMaps: true });
    if (typeof plugin.transform !== 'function') {
      throw new TypeError('Expected a callable transform hook.');
    }

    // When: Babel transforms the original TypeScript module.
    const result: unknown = await Reflect.apply(plugin.transform, {}, [source, '/app/src/dto.ts']);

    // Then: either supported map representation preserves the original source and mappings.
    if (typeof result !== 'object' || result === null || !('map' in result)) {
      throw new TypeError('Expected a transform result with a source map.');
    }
    const decoded: unknown = typeof result.map === 'string' ? JSON.parse(result.map) : result.map;
    if (typeof decoded !== 'object' || decoded === null) {
      throw new TypeError('Expected a decoded source map object.');
    }
    expect(Reflect.get(decoded, 'version')).toBe(3);
    expect(Reflect.get(decoded, 'sources')).toEqual(['dto.ts']);
    expect(Reflect.get(decoded, 'sourcesContent')).toEqual([source]);
    const mappings: unknown = Reflect.get(decoded, 'mappings');
    expect(typeof mappings === 'string' && mappings.length > 0).toBe(true);
  });
});
