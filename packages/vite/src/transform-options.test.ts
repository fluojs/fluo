import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fluoDecoratorsPlugin } from './index.js';

type BabelTransformAsync = typeof import('@babel/core').transformAsync;

type MinimalResolvedViteConfig = {
  readonly command: 'build' | 'serve';
  readonly build: {
    readonly sourcemap: boolean | 'hidden' | 'inline';
  };
};

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

function runConfigResolved(plugin: Plugin, config: MinimalResolvedViteConfig): void {
  if (typeof plugin.configResolved !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable configResolved hook.');
  }

  Reflect.apply(plugin.configResolved, {}, [config]);
}

describe('fluoDecoratorsPlugin transform options', () => {
  afterEach(() => {
    transformAsyncMock.mockClear();
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

  it.each([
    ['TypeScript', '/app/src/auth/login.dto.ts'],
    ['TSX with a Vite query', '/app/src/auth/login.dto.tsx?import'],
  ] as const)('transforms DTO-like decorated definite-assignment fields in %s modules', async (_kind, id) => {
    // Given
    const plugin = fluoDecoratorsPlugin();

    // When
    const result = await runTransform(
      plugin,
      `function IsEmail(_value: unknown, _context: ClassFieldDecoratorContext) {}
function ApiProperty(_value: unknown, _context: ClassFieldDecoratorContext) {}

export class LoginDto {
  @ApiProperty
  @IsEmail
  email!: string;
}
`,
      id,
    );

    // Then
    const transformedCode = result && typeof result === 'object' && 'code' in result && typeof result.code === 'string'
      ? result.code
      : '';
    expect(transformedCode).toContain('@fluojs/core/metadata-preload');
    expect(transformedCode).toContain('_init_email');
  });

  it('preserves metadata preload for DTO definite-assignment fields with an explicit Babel config', async () => {
    // Given
    const babelConfigFile = fileURLToPath(new URL('../../../tooling/babel/babel.config.cjs', import.meta.url));
    const plugin = fluoDecoratorsPlugin({ babelConfigFile, transformBoundary: 'test' });

    // When
    const result = await runTransform(
      plugin,
      `function IsString() {
  return function (_value: unknown, _context: ClassFieldDecoratorContext) {};
}
function IsNotEmpty() {
  return function (_value: unknown, _context: ClassFieldDecoratorContext) {};
}
function FromBody(_name: string) {
  return function (_value: unknown, _context: ClassFieldDecoratorContext) {};
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @FromBody('username')
  username!: string;
}
`,
      '/app/src/auth/login.dto.test.ts',
    );

    // Then
    const transformedCode = result && typeof result === 'object' && 'code' in result && typeof result.code === 'string'
      ? result.code
      : '';
    expect(transformedCode).toContain('@fluojs/core/metadata-preload');
    expect(transformedCode).toContain('_init_username');
  });

  it('locks Babel decorator transforms to the documented 2023-11 proposal version', async () => {
    const plugin = fluoDecoratorsPlugin();

    await runTransform(plugin, 'export class Example {}', '/app/src/example.ts?import');

    expect(transformAsyncMock).toHaveBeenCalledTimes(1);
    expect(transformAsyncMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        filename: '/app/src/example.ts',
        presets: [
          expect.any(Function),
          ['@babel/preset-typescript', { allowDeclareFields: true }],
        ],
      }),
    );
  });

  it('uses explicit test-boundary Babel and sourcemap options', async () => {
    // Given
    const babelConfigFile = fileURLToPath(new URL('../../../tooling/babel/babel.config.cjs', import.meta.url));
    const plugin = fluoDecoratorsPlugin({
      babelConfigFile: () => babelConfigFile,
      sourceMaps: true,
      transformBoundary: 'test',
    });

    // When
    await runTransform(plugin, 'export const value: number = 1;', '/app/src/example.test.tsx');

    // Then
    expect(transformAsyncMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      configFile: babelConfigFile,
      plugins: [expect.objectContaining({ name: 'fluo-metadata-preload' })],
      presets: [],
      sourceMaps: true,
    }));
  });
});
