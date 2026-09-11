import type { Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { fluoDecoratorsPlugin } from './index.js';

type BabelTransformAsync = typeof import('@babel/core').transformAsync;

const transformAsyncMock = vi.hoisted(() => vi.fn<BabelTransformAsync>());

vi.mock('@babel/core', async (importOriginal) => {
  const babelCore = await importOriginal<typeof import('@babel/core')>();
  transformAsyncMock.mockImplementation(babelCore.transformAsync);

  return {
    ...babelCore,
    transformAsync: transformAsyncMock,
  };
});

function runTransform(plugin: Plugin, code: string, id: string): unknown {
  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable transform hook.');
  }

  return Reflect.apply(plugin.transform, {}, [code, id]);
}

describe('fluoDecoratorsPlugin transform boundary', () => {
  it('transforms every application TypeScript extension while preserving test and declaration boundaries', async () => {
    // Given
    const plugin = fluoDecoratorsPlugin();
    const code = 'export const value: number = 1;';

    // When
    const tsxResult = runTransform(plugin, code, '/app/src/component.tsx');
    const mtsResult = runTransform(plugin, code, '/app/src/module.mts');
    const ctsResult = runTransform(plugin, code, '/app/src/module.cts');
    const specResult = runTransform(plugin, code, '/app/src/component.spec.tsx');
    const declarationResult = runTransform(plugin, code, '/app/src/types.d.mts');

    // Then
    await expect(tsxResult).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
    await expect(mtsResult).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
    await expect(ctsResult).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
    await expect(specResult).resolves.toBeNull();
    await expect(declarationResult).resolves.toBeNull();
  });

  it('preloads metadata before an eligible decorated module is evaluated', async () => {
    // Given
    const plugin = fluoDecoratorsPlugin();

    // When
    const result = await runTransform(
      plugin,
      'export class DecoratedValue { @field value = 1; }',
      '/app/src/decorated-value.ts',
    );

    // Then
    expect(result).toEqual(expect.objectContaining({
      code: expect.stringContaining("@fluojs/core/metadata-preload"),
    }));
  });

  it('keeps the Vite transform boundary on application TypeScript files', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.spec.ts')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts?import')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts#hash')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/types.d.ts')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/types.d.ts?raw')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/types.d.ts#hash')).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/node_modules/dependency/index.ts'),
    ).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/node_modules/dependency/index.ts?v=1'),
    ).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/node_modules/dependency/index.ts#hash'),
    ).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', 'C:\\app\\node_modules\\dependency\\index.ts'),
    ).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.tsx?import')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.tsx#hash')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts?import')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts#hash')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
  });
});
