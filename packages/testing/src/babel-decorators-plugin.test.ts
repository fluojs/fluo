import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { transformAsync } from '@babel/core';
import { describe, expect, it, vi } from 'vitest';

import { createFluoBabelDecoratorsPlugin, resolveNearestBabelConfigFile } from './babel-decorators-plugin.js';

vi.mock('@babel/core', () => ({
  transformAsync: vi.fn(async () => ({
    code: 'transformed();',
    map: { mappings: '' },
  })),
}));

const mockedTransformAsync = vi.mocked(transformAsync);

function createWorkspaceWithConfig(configFileName: string): { filePath: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'fluo-testing-babel-'));
  const sourceDirectory = join(root, 'src', 'feature');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(root, configFileName), 'module.exports = {};');
  writeFileSync(join(sourceDirectory, '.keep'), '', { flag: 'w' });

  return {
    filePath: join(sourceDirectory, 'app.ts'),
    root,
  };
}

describe('fluoBabelDecoratorsPlugin', () => {
  it('normalizes Vite query-suffixed TypeScript ids before transforming', async () => {
    mockedTransformAsync.mockClear();
    const plugin = createFluoBabelDecoratorsPlugin((filePath) => `${filePath}.config.cjs`);

    await expect(plugin.transform('@Module({}) class AppModule {}', '/workspace/src/app.ts?import')).resolves.toEqual({
      code: 'transformed();',
      map: { mappings: '' },
    });

    expect(mockedTransformAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      configFile: '/workspace/src/app.ts.config.cjs',
      filename: '/workspace/src/app.ts',
    }));
  });

  it('transforms TS variants while skipping dependencies', async () => {
    mockedTransformAsync.mockClear();
    const plugin = createFluoBabelDecoratorsPlugin((filePath) => `${filePath}.config.cjs`);

    await expect(plugin.transform('class Component {}', '/workspace/src/component.tsx')).resolves.not.toBeNull();
    await expect(plugin.transform('class Cli {}', '/workspace/src/cli.mts')).resolves.not.toBeNull();
    await expect(plugin.transform('class Legacy {}', '/workspace/src/legacy.cts')).resolves.not.toBeNull();
    await expect(plugin.transform('class Dependency {}', '/workspace/node_modules/pkg/index.ts?raw')).resolves.toBeNull();
  });

  it('resolves supported Babel root config names from query-suffixed ids', () => {
    const { filePath, root } = createWorkspaceWithConfig('babel.config.mjs');

    expect(resolveNearestBabelConfigFile(`${filePath}?v=123`)).toBe(join(root, 'babel.config.mjs'));
  });
});
