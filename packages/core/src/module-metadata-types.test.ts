import { expect, expectTypeOf, it } from 'vitest';

import { getModuleMetadata, Module } from './index.js';
import type { ModuleMetadata } from './internal.js';

it('models module collections as readonly frozen snapshots', () => {
  // Given
  class SharedModule {}
  const imports = [SharedModule] as const;

  // When
  @Module({ imports })
  class AppModule {}
  const metadata: ModuleMetadata | undefined = getModuleMetadata(AppModule);

  // Then
  expectTypeOf(metadata?.imports).toEqualTypeOf<readonly unknown[] | undefined>();
  expect(metadata?.imports).toEqual(imports);
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(Object.isFrozen(metadata?.imports)).toBe(true);
});
