import { readFileSync } from 'node:fs';

import { transformAsync, version as babelVersion } from '@babel/core';
import { describe, expect, it } from 'vitest';

interface CompilerManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly engines?: { readonly node?: string };
  readonly pnpm?: { readonly overrides?: Readonly<Record<string, string>> };
}

function readManifest(relativePath: string): CompilerManifest {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('Babel 8 toolchain baseline', () => {
  it('pins root workspace compiler dependencies to Babel 8 without obsolete Babel 7 types', () => {
    // Given: the private root workspace compiles the workspace through Babel 8.
    const root = readManifest('../../package.json');

    // When: consumers read the root compiler dependency baseline.
    // Then: Babel 8 releases are pinned, the removed Babel 7 type stub is gone,
    // and the Babel 7 security override only targets pre-8 resolutions.
    expect(root.devDependencies?.['@babel/core']).toBe('^8.0.6');
    expect(root.devDependencies?.['@babel/cli']).toBe('^8.0.6');
    expect(root.devDependencies?.['@babel/plugin-proposal-decorators']).toBe('^8.0.2');
    expect(root.devDependencies?.['@babel/preset-typescript']).toBe('^8.0.1');
    expect(root.devDependencies?.['@types/babel__core']).toBeUndefined();
    expect(root.pnpm?.overrides?.['@babel/core@<8']).toBe('7.29.7');
    expect(root.pnpm?.overrides).not.toHaveProperty('@babel/core');
  });

  it('keeps the Vite Babel peer baseline at 8', () => {
    // Given: the published @fluojs/vite peer surface.
    const vite = readManifest('../../packages/vite/package.json');

    // When: consumers install their own Babel compiler for the plugin.
    // Then: the peers no longer admit the removed Babel 7 baseline.
    expect(vite.peerDependencies?.['@babel/core']).toBe('>=8.0.0');
    expect(vite.peerDependencies?.['@babel/plugin-proposal-decorators']).toBe('>=8.0.0');
    expect(vite.peerDependencies?.['@babel/preset-typescript']).toBe('>=8.0.0');
  });

  it('moves the packaged Next compiler onto Babel 8 dependencies', () => {
    // Given: @fluojs/platform-nextjs owns its decorator compiler dependencies.
    const nextjs = readManifest('../../packages/platform-nextjs/package.json');

    // When: the published package installs its compiler closure.
    // Then: the direct Babel dependencies resolve the Babel 8 line.
    expect(nextjs.dependencies?.['@babel/core']).toBe('^8.0.6');
    expect(nextjs.dependencies?.['@babel/plugin-proposal-decorators']).toBe('^8.0.2');
    expect(nextjs.dependencies?.['@babel/preset-typescript']).toBe('^8.0.1');
  });

  it('raises the Babel-using examples to Babel 8 dependencies and the compiler toolchain floor', () => {
    // Given: both Babel-using examples stay private workspace members.
    const manifestPaths = [
      '../../examples/fluo-blog/package.json',
      '../../examples/react-vite-ssr/package.json',
    ];

    // When: the example manifests are evaluated.
    // Then: their engines and Babel dependencies follow the toolchain migration.
    for (const manifestPath of manifestPaths) {
      const manifest = readManifest(manifestPath);
      expect(manifest.engines?.node, manifestPath).toBe('>=24.11.0 <27');
      expect(manifest.devDependencies?.['@babel/core'], manifestPath).toBe('^8.0.6');
      expect(manifest.devDependencies?.['@babel/plugin-proposal-decorators'], manifestPath).toBe('^8.0.2');
      expect(manifest.devDependencies?.['@babel/preset-typescript'], manifestPath).toBe('^8.0.1');
    }
  });

  it('transforms decorated fields with the installed workspace Babel 8 without allowDeclareFields', async () => {
    // Given: the workspace installs Babel 8 and the TC39 2023-11 decorator mode.
    expect(babelVersion).toMatch(/^8\./u);

    // When: a declaration-only decorated field compiles without the removed option.
    const result = await transformAsync(
      `
      const bindings: string[] = [];
      function Field(_value: undefined, context: ClassFieldDecoratorContext) {
        bindings.push(String(context.name));
      }
      class BaseDto {
        code = 'base';
      }
      class TestDto extends BaseDto {
        declare readonly code: string;
        @Field
        name = '';
      }
      const dto = new TestDto();
      export default { bindings, code: dto.code };
    `,
      {
        babelrc: false,
        configFile: false,
        filename: '/app/src/dto.ts',
        plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
        presets: ['@babel/preset-typescript'],
      },
    );

    // Then: the transform preserves decorated field semantics.
    if (!result?.code) {
      throw new TypeError('Expected Babel 8 to emit transformed code.');
    }
    const module = await import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`);
    expect(module.default).toEqual({ bindings: ['name'], code: 'base' });
  });
});
