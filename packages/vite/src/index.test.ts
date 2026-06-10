import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluoDecoratorsPluginForTesting } from './decorators-plugin.js';
import { fluoDecoratorsPlugin } from './index.js';

type BabelTransformAsync = typeof import('@babel/core').transformAsync;

const babelCoreMockState = vi.hoisted(() => ({
  loadCount: 0,
  transformAsyncMock: vi.fn<BabelTransformAsync>(),
}));

type MinimalResolvedViteConfig = {
  readonly command: 'build' | 'serve';
  readonly build: {
    readonly sourcemap: boolean | 'hidden' | 'inline';
  };
};

vi.mock('@babel/core', async (importOriginal) => {
  babelCoreMockState.loadCount += 1;
  const babelCore = await importOriginal<typeof import('@babel/core')>();
  babelCoreMockState.transformAsyncMock.mockImplementation(babelCore.transformAsync);

  return {
    ...babelCore,
    transformAsync: babelCoreMockState.transformAsyncMock,
  };
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonFile(path: URL): Promise<Record<string, unknown>> {
  const content = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(content);

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${path.pathname} to contain a JSON object.`);
  }

  return parsed;
}

function readRecordProperty(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];

  if (!isRecord(value)) {
    throw new Error(`Expected ${key} to contain a JSON object.`);
  }

  return value;
}

function readStringArrayProperty(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Expected ${key} to contain a string array.`);
  }

  return value;
}

function runTransform(plugin: Plugin, code: string, id: string): unknown {
  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable transform hook.');
  }

  return Reflect.apply(plugin.transform, {}, [code, id]);
}

function runConfigResolved(plugin: Plugin, config: MinimalResolvedViteConfig): void {
  if (typeof plugin.configResolved !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable configResolved hook.');
  }

  Reflect.apply(plugin.configResolved, {}, [config]);
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

  it('skips generated test files', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts')).resolves.toBeNull();
  });

  it('keeps package build outputs aligned with the documented test/spec skip contract', async () => {
    const packageJson = await readJsonFile(new URL('../package.json', import.meta.url));
    const buildConfig = await readJsonFile(new URL('../tsconfig.build.json', import.meta.url));
    const scripts = readRecordProperty(packageJson, 'scripts');

    expect(scripts.build).toContain("--ignore 'src/**/*.test.ts','src/**/*.spec.ts'");
    expect(readStringArrayProperty(buildConfig, 'exclude')).toEqual(['src/**/*.test.ts', 'src/**/*.spec.ts']);
  });

  it('keeps the Vite transform boundary on application TypeScript files', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.spec.ts')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts?import')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/types.d.ts')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/types.d.ts?raw')).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/node_modules/dependency/index.ts'),
    ).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/node_modules/dependency/index.ts?v=1'),
    ).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', 'C:\\app\\node_modules\\dependency\\index.ts'),
    ).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.tsx')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.tsx?import')).resolves.toBeNull();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts?import')).resolves.toEqual(
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

  it('transforms application TypeScript files whose names contain test or spec substrings', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/latest.service.ts')).resolves.toEqual(
      expect.objectContaining({ code: expect.any(String) }),
    );
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/src/features/order.spec.builder.ts'),
    ).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
  });

  it('omits Babel sourcemaps during builds when Vite build sourcemaps are disabled', async () => {
    const plugin = fluoDecoratorsPlugin();
    runConfigResolved(plugin, { command: 'build', build: { sourcemap: false } });

    await runTransform(plugin, 'export const value: number = 1;', '/app/src/example.ts');

    expect(transformAsyncMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ sourceMaps: false }));
  });

  it('requests Babel sourcemaps when Vite serves modules or build sourcemaps are enabled', async () => {
    const servePlugin = fluoDecoratorsPlugin();
    runConfigResolved(servePlugin, { command: 'serve', build: { sourcemap: false } });

    await runTransform(servePlugin, 'export const value: number = 1;', '/app/src/dev.ts');

    const buildPlugin = fluoDecoratorsPlugin();
    runConfigResolved(buildPlugin, { command: 'build', build: { sourcemap: 'hidden' } });

    await runTransform(buildPlugin, 'export const value: number = 1;', '/app/src/build.ts');

    expect(transformAsyncMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ sourceMaps: true }));
    expect(transformAsyncMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ sourceMaps: true }));
  });

  it('transforms TypeScript files with standard decorators through Babel', async () => {
    const plugin = fluoDecoratorsPlugin();
    const result = await runTransform(
      plugin,
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

  it('locks Babel decorator transforms to the documented 2023-11 proposal version', async () => {
    const plugin = fluoDecoratorsPlugin();

    await runTransform(plugin, 'export class Example {}', '/app/src/example.ts?import');

    expect(transformAsyncMock).toHaveBeenCalledTimes(1);
    expect(transformAsyncMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        filename: '/app/src/example.ts',
        plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
        presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
      }),
    );
  });

  it('reports missing @babel/core peer from the lazy dynamic import branch', async () => {
    const plugin = createFluoDecoratorsPluginForTesting(async () => {
      throw createMissingPeerError('@babel/core', 'ERR_MODULE_NOT_FOUND');
    });

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.ts')).rejects.toThrow(
      `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming /app/src/component.ts. Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. Original error: Cannot find package '@babel/core' imported from vite.config.ts`,
    );
  });
});
