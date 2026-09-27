import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

      return { transformAsync: transformAsyncMock, version: '7.29.7' };
    });

    expect(testImporterCallCount).toBe(0);
  });

  it('reuses a successfully loaded Babel module after the first eligible transform', async () => {
    const transformAsync = vi.fn<BabelTransformAsync>().mockResolvedValue({ code: 'export const transformed = true;', map: null });
    let importerCallCount = 0;
    const plugin = createFluoDecoratorsPluginForTesting(async () => {
      importerCallCount += 1;

      return { transformAsync, version: '7.29.7' };
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

  it.each([
    ['file URL', new URL('../../../tooling/babel/babel.config.cjs', import.meta.url).href],
    ['filesystem path', fileURLToPath(new URL('../../../tooling/babel/babel.config.cjs', import.meta.url))],
  ])('loads an existing Babel config from a %s for eligible transforms', async (_kind, babelConfigFile) => {
    // Given
    const plugin = fluoDecoratorsPlugin({ babelConfigFile, sourceMaps: true });

    // When
    const result = await runTransform(
      plugin,
      `function Field(_value: undefined, _context: ClassFieldDecoratorContext) {}
export class Example {
  @Field
  name = '';
}`,
      '/app/src/example.ts',
    );

    // Then
    expect(result).toEqual(expect.objectContaining({
      code: expect.stringContaining('@fluojs/core/metadata-preload'),
      map: expect.any(Object),
    }));
    expect(transformAsyncMock.mock.calls[0]?.[1]?.configFile).toBe(fileURLToPath(new URL('../../../tooling/babel/babel.config.cjs', import.meta.url)));
  });

  it('resolves file URL and path callback results per eligible module', async () => {
    // Given
    const babelConfigUrl = new URL('../../../tooling/babel/babel.config.cjs', import.meta.url);
    const resolvedFiles: string[] = [];
    const plugin = fluoDecoratorsPlugin({
      babelConfigFile: (filePath) => {
        resolvedFiles.push(filePath);
        return filePath.endsWith('first.ts') ? babelConfigUrl.href : fileURLToPath(babelConfigUrl);
      },
    });

    // When
    await runTransform(plugin, 'export const first: number = 1;', '/app/src/first.ts');
    await runTransform(plugin, 'export const second: number = 2;', '/app/src/second.ts?import');

    // Then
    expect(resolvedFiles).toEqual(['/app/src/first.ts', '/app/src/second.ts']);
    expect(transformAsyncMock.mock.calls.map(([, options]) => options?.configFile)).toEqual([
      fileURLToPath(babelConfigUrl),
      fileURLToPath(babelConfigUrl),
    ]);
  });

  it('reports a missing custom config as a config failure with the Babel cause', async () => {
    // Given
    const directory = mkdtempSync(join(tmpdir(), 'fluo-3835-missing-config-'));
    const babelConfigFile = join(directory, 'babel.config.cjs');
    const plugin = fluoDecoratorsPlugin({ babelConfigFile });

    try {
      // When / Then
      await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.ts')).rejects.toMatchObject({
        message: expect.stringContaining(`babelConfigFile not found at ${babelConfigFile} while transforming /app/src/example.ts`),
        cause: expect.objectContaining({ code: 'MODULE_NOT_FOUND' }),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports an invalid file URL as a config resolution failure with its cause', async () => {
    // Given
    const babelConfigFile = 'file://example.invalid/babel.config.cjs';
    const plugin = fluoDecoratorsPlugin({ babelConfigFile });

    // When / Then
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.ts')).rejects.toMatchObject({
      message: expect.stringContaining(`Failed to resolve babelConfigFile ${babelConfigFile} while transforming /app/src/example.ts`),
      cause: expect.objectContaining({ code: 'ERR_INVALID_FILE_URL_HOST' }),
    });
  });

  it.each([
    ['with invalid syntax', 'module.exports = {', 'Unexpected end of input'],
    ['with a missing dependency', "require('@babel/fluo-3835-absent'); module.exports = {};", '@babel/fluo-3835-absent'],
  ])('reports an existing config %s as a config load failure', async (_kind, content, causeMessage) => {
    // Given
    const directory = mkdtempSync(join(tmpdir(), 'fluo-3835-config-'));
    const babelConfigFile = join(directory, 'babel.config.cjs');
    writeFileSync(babelConfigFile, content);
    const plugin = fluoDecoratorsPlugin({ babelConfigFile });

    try {
      // When / Then
      await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.ts')).rejects.toMatchObject({
        message: expect.stringContaining(`Failed to load babelConfigFile ${babelConfigFile} while transforming /app/src/example.ts`),
        cause: expect.objectContaining({ message: expect.stringContaining(causeMessage) }),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports an existing relative config with invalid syntax as a config load failure', async () => {
    // Given
    const directory = mkdtempSync(join(process.cwd(), 'fluo-3835-relative-config-'));
    const babelConfigFile = `./${basename(directory)}/babel.config.cjs`;
    writeFileSync(join(directory, 'babel.config.cjs'), 'module.exports = {');
    const plugin = fluoDecoratorsPlugin({ babelConfigFile });

    try {
      // When / Then
      await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.ts')).rejects.toMatchObject({
        message: expect.stringContaining(`Failed to load babelConfigFile ${babelConfigFile} while transforming /app/src/example.ts`),
        cause: expect.objectContaining({ message: expect.stringContaining('Unexpected end of input') }),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps peer-install advice for a real missing Babel core resolution', async () => {
    // Given
    const directory = mkdtempSync(join(tmpdir(), 'fluo-3835-absent-peers-'));
    const isolatedRequire = createRequire(join(directory, 'vite.config.mjs'));
    const plugin = createFluoDecoratorsPluginForTesting(async () => {
      isolatedRequire.resolve('@babel/core');
      return await import('@babel/core');
    });

    try {
      // When / Then
      await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.ts')).rejects.toThrow(
        'Failed to resolve a Babel peer dependency while transforming /app/src/example.ts.',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('skips ineligible files without resolving a custom Babel config', async () => {
    // Given
    const plugin = fluoDecoratorsPlugin({ babelConfigFile: 'file://example.invalid/babel.config.cjs' });

    // When / Then
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.test.ts')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/example.d.ts')).resolves.toBeNull();
    expect(transformAsyncMock).not.toHaveBeenCalled();
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

  it('transforms decorated TypeScript fields through the Babel 7 default', async () => {
    const plugin = fluoDecoratorsPlugin();
    const result = await runTransform(
      plugin,
      `function Field(_value: undefined, _context: ClassFieldDecoratorContext) {}
export class Example {
  @Field
  name = '';
}`,
      '/app/src/field.ts',
    );

    expect(result).toEqual(expect.objectContaining({
      code: expect.stringContaining('@fluojs/core/metadata-preload'),
    }));
    expect(result).toEqual(expect.objectContaining({
      code: expect.not.stringContaining("name = '';"),
    }));
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
