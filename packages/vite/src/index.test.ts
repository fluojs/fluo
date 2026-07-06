import type { Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluoDecoratorsPluginForTesting } from './decorators-plugin.js';
import { fluoDecoratorsPlugin } from './index.js';

type BabelTransformAsync = typeof import('@babel/core').transformAsync;

const babelCoreMockState = vi.hoisted(() => ({
  loadCount: 0,
  transformAsyncMock: vi.fn<BabelTransformAsync>(),
}));

vi.mock('@babel/core', async (importOriginal) => {
  babelCoreMockState.loadCount += 1;
  const babelCore = await importOriginal<typeof import('@babel/core')>();
  babelCoreMockState.transformAsyncMock.mockImplementation(babelCore.transformAsync);

  return {
    ...babelCore,
    transformAsync: babelCoreMockState.transformAsyncMock,
  };
});

function runTransform(plugin: Plugin, code: string, id: string): unknown {
  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable transform hook.');
  }

  return Reflect.apply(plugin.transform, {}, [code, id]);
}

function createMissingPeerError(dependencyName: string, code: string): Error & { code: string } {
  return Object.assign(new Error(`Cannot find package '${dependencyName}' imported from vite.config.ts`), { code });
}

const transformAsyncMock = babelCoreMockState.transformAsyncMock;

describe('fluoDecoratorsPlugin', () => {
  afterEach(() => {
    transformAsyncMock.mockClear();
  });

  it('loads Babel lazily only after an eligible source transform', async () => {
    const initialBabelLoadCount = babelCoreMockState.loadCount;
    const plugin = fluoDecoratorsPlugin();

    expect(babelCoreMockState.loadCount).toBe(initialBabelLoadCount);
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts')).resolves.toBeNull();
    expect(babelCoreMockState.loadCount).toBe(initialBabelLoadCount);

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
    expect(babelCoreMockState.loadCount).toBe(initialBabelLoadCount + 1);
  });

  it('does not load Babel for bare plugin import or creation', () => {
    const initialBabelLoadCount = babelCoreMockState.loadCount;
    const plugin = fluoDecoratorsPlugin();

    expect(plugin.name).toBe('fluo-babel-decorators');
    expect(babelCoreMockState.loadCount).toBe(initialBabelLoadCount);

    let testImporterCallCount = 0;
    createFluoDecoratorsPluginForTesting(async () => {
      testImporterCallCount += 1;

      return { transformAsync: transformAsyncMock };
    });

    expect(testImporterCallCount).toBe(0);
  });

  it('reuses a successfully loaded Babel module after the first eligible transform', async () => {
    const transformAsync = vi.fn<BabelTransformAsync>().mockResolvedValue({ code: 'export const transformed = true;', map: null });
    let importerCallCount = 0;
    const plugin = createFluoDecoratorsPluginForTesting(async () => {
      importerCallCount += 1;

      return { transformAsync };
    });

    await expect(runTransform(plugin, 'export const first: number = 1;', '/app/src/first.ts')).resolves.toEqual({
      code: 'export const transformed = true;',
      map: null,
    });
    await expect(runTransform(plugin, 'export const second: number = 2;', '/app/src/second.ts')).resolves.toEqual({
      code: 'export const transformed = true;',
      map: null,
    });

    expect(importerCallCount).toBe(1);
    expect(transformAsync).toHaveBeenCalledTimes(2);
  });

  it('keeps concurrent first eligible transforms on the lazy Babel transform path', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(
      Promise.all([
        runTransform(plugin, 'export const first: number = 1;', '/app/src/first.ts'),
        runTransform(plugin, 'export const second: number = 2;', '/app/src/second.ts'),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ code: expect.any(String) }),
      expect.objectContaining({ code: expect.any(String) }),
    ]);

    await expect(runTransform(plugin, 'export const third: number = 3;', '/app/src/third.ts')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
  });

  it('skips generated test files', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts')).resolves.toBeNull();
  });

  it.each([
    ['@babel/core', 'ERR_MODULE_NOT_FOUND'],
    ['@babel/plugin-proposal-decorators', 'MODULE_NOT_FOUND'],
    ['@babel/preset-typescript', 'ERR_MODULE_NOT_FOUND'],
  ])('reports missing %s peer from the transform hook instead of plugin creation', async (dependencyName, code) => {
    const plugin = fluoDecoratorsPlugin();
    const missingPeerError = createMissingPeerError(dependencyName, code);

    transformAsyncMock.mockRejectedValueOnce(missingPeerError);

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts')).rejects.toThrow(
      `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming /app/src/component.ts. Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. Original error: Cannot find package '${dependencyName}' imported from vite.config.ts`,
    );
  });

  it('transforms application TypeScript files whose names contain test or spec substrings', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/latest.service.ts')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/src/features/order.spec.builder.ts'),
    ).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
  });

  it('reports missing @babel/core peer from the lazy dynamic import branch', async () => {
    const plugin = createFluoDecoratorsPluginForTesting(async () => {
      throw createMissingPeerError('@babel/core', 'ERR_MODULE_NOT_FOUND');
    });

    expect(plugin.name).toBe('fluo-babel-decorators');
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.test.ts')).resolves.toBeNull();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts')).rejects.toThrow(
      `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming /app/src/component.ts. Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. Original error: Cannot find package '@babel/core' imported from vite.config.ts`,
    );
  });

  it('does not cache failed lazy Babel imports across source file diagnostics', async () => {
    const plugin = createFluoDecoratorsPluginForTesting(async () => {
      throw createMissingPeerError('@babel/core', 'ERR_MODULE_NOT_FOUND');
    });

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/first.ts')).rejects.toThrow(
      `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming /app/src/first.ts. Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. Original error: Cannot find package '@babel/core' imported from vite.config.ts`,
    );
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/second.ts')).rejects.toThrow(
      `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming /app/src/second.ts. Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. Original error: Cannot find package '@babel/core' imported from vite.config.ts`,
    );
  });
});
