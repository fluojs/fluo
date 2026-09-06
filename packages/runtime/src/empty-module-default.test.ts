import { getModuleMetadata, Module } from '@fluojs/core';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

describe('empty decorated module bootstrap', () => {
  it.each([
    { name: 'omitted', factory: () => Module() },
    { name: 'undefined', factory: () => Module(undefined) },
    { name: 'empty object', factory: () => Module({}) },
  ])('bootstraps and closes a module with $name metadata', async ({ factory }) => {
    // Given
    const decorator = factory();
    @decorator
    class EmptyModule {}

    // When
    const app = await bootstrapApplication({ rootModule: EmptyModule });

    // Then
    try {
      expect(getModuleMetadata(EmptyModule)).toBeDefined();
      expect(app.dispatcher.describeRoutes?.()).toEqual([]);
    } finally {
      await app.close();
    }
    await expect(app.close()).resolves.toBeUndefined();
  });
});
