import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type PluginOption, version as viteVersion } from 'vite';
import { describe, expect, it } from 'vitest';

import { fluoDecoratorsPlugin } from './index.js';

const fixturePath = fileURLToPath(new URL('../test-fixtures/vite8-field-decorator.ts', import.meta.url));
const babelConfigUrl = new URL('../../../tooling/babel/babel.config.cjs', import.meta.url).href;
const babel8FixtureScript = fileURLToPath(new URL('../../../tooling/babel/babel8-fixture.mjs', import.meta.url));
const coreEntryPath = fileURLToPath(new URL('../../core/src/index.ts', import.meta.url));
const coreInternalPath = fileURLToPath(new URL('../../core/src/internal.ts', import.meta.url));
const coreMetadataPreloadPath = fileURLToPath(new URL('../../core/src/metadata-preload.ts', import.meta.url));
const coreRequestPipelinePath = fileURLToPath(new URL('../../core/src/request-pipeline.ts', import.meta.url));
const httpDecoratorsPath = fileURLToPath(new URL('../../http/src/decorators.ts', import.meta.url));
const decoratorBoundaryProbe: Plugin = {
  name: 'decorator-boundary-probe',
  transform(code, id) {
    if (id === fixturePath && code.includes('@FromBody')) {
      throw new Error('Field decorator syntax reached the normal Vite plugin stage.');
    }

    return null;
  },
};
const aliases = [
  { find: '@fluojs/core/metadata-preload', replacement: coreMetadataPreloadPath },
  { find: '@fluojs/core/request-pipeline', replacement: coreRequestPipelinePath },
  { find: '@fluojs/core/internal', replacement: coreInternalPath },
  { find: '@fluojs/core', replacement: coreEntryPath },
  { find: '@fluojs/http', replacement: httpDecoratorsPath },
];

describe('fluoDecoratorsPlugin Vite build integration', () => {
  it.each([
    ['built-in preset', undefined],
    ['file URL config', babelConfigUrl],
  ])('preserves field decorator metadata through the workspace Vite build pipeline with %s', async (_label, babelConfigFile) => {
    const name = `workspace Vite ${viteVersion} Rolldown with Babel 7`;
    const plugin = fluoDecoratorsPlugin(babelConfigFile ? { babelConfigFile } : {}) as unknown as PluginOption;
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [decoratorBoundaryProbe, plugin],
      resolve: {
        alias: aliases,
      },
      build: {
        minify: false,
        ssr: fixturePath,
        write: false,
      },
    });
    if (Array.isArray(result) || !('output' in result)) {
      throw new Error('Expected one Vite build output.');
    }

    const chunk = result.output.find((output) => output.type === 'chunk');

    expect(chunk?.type).toBe('chunk');
    if (chunk?.type !== 'chunk') {
      return;
    }

    const encodedModule = Buffer.from(chunk.code).toString('base64');
    const bundledModule = await import(`data:text/javascript;base64,${encodedModule}#${encodeURIComponent(name)}`);

    expect(bundledModule.default).toEqual([
      {
        metadata: { key: 'display_name', source: 'body' },
        propertyKey: 'name',
      },
    ]);
  });

  it('executes a real SSR build using the packaged plugin and isolated Babel 8 dependencies', () => {
    const babel8Root = execFileSync(process.execPath, [babel8FixtureScript], { encoding: 'utf8' });
    try {
      const isolatedFixturePath = join(babel8Root, 'src/vite8-field-decorator.ts');
      mkdirSync(join(babel8Root, 'src'), { recursive: true });
      writeFileSync(isolatedFixturePath, readFileSync(fixturePath));
      const script = `
      import { build } from 'vite';
      import { version as babelVersion } from '@babel/core';
      import { fluoDecoratorsPlugin } from '@fluojs/vite';
      if (!babelVersion.startsWith('8.')) throw new Error('Expected isolated Babel 8.');
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [fluoDecoratorsPlugin()],
        resolve: { alias: ${JSON.stringify(aliases)} },
        build: { minify: false, ssr: ${JSON.stringify(isolatedFixturePath)}, write: false },
      });
      const chunk = result.output.find((output) => output.type === 'chunk');
      if (!chunk) throw new Error('Expected a Vite SSR output chunk.');
      const emitted = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
      process.stdout.write(JSON.stringify(emitted.default));
    `;
      const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: babel8Root,
        encoding: 'utf8',
      });
      expect(JSON.parse(output)).toEqual([{ metadata: { key: 'display_name', source: 'body' }, propertyKey: 'name' }]);
    } finally {
      rmSync(babel8Root, { recursive: true, force: true });
    }
  });
});
