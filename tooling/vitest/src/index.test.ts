import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FLUO_VITEST_SHUTDOWN_DEBUG_ENV } from './shutdown-debug.js';
import { collectWorkspaceAliases, createFluoVitestWorkspaceConfig } from './index.js';

function writePackage(root: string, directoryName: string, packageName: string, sourceFiles: Record<string, string>) {
  const packageRoot = join(root, 'packages', directoryName);
  const sourceRoot = join(packageRoot, 'src');

  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName }, null, 2));

  for (const [relativePath, content] of Object.entries(sourceFiles)) {
    writeFileSync(join(sourceRoot, relativePath), content);
  }
}

describe('collectWorkspaceAliases', () => {
  it('uses manifest package names instead of package directory names', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'fluo-vitest-alias-'));

    writePackage(repoRoot, 'websocket', '@fluojs/websockets', {
      'index.ts': 'export {}\n',
      'node.ts': 'export {}\n',
    });
    writePackage(repoRoot, 'platform-socket.io', '@fluojs/socket.io', {
      'index.ts': 'export {}\n',
      'module.ts': 'export {}\n',
    });
    writePackage(repoRoot, 'runtime', '@fluojs/runtime', {
      'index.ts': 'export {}\n',
      'internal-http-adapter.ts': 'export {}\n',
      'internal-request-response-factory.ts': 'export {}\n',
    });

    const aliases = collectWorkspaceAliases(pathToFileURL(`${repoRoot}/`));

    expect(aliases['@fluojs/websockets']).toBe(join(repoRoot, 'packages', 'websocket', 'src', 'index.ts'));
    expect(aliases['@fluojs/websockets/node']).toBe(join(repoRoot, 'packages', 'websocket', 'src', 'node.ts'));
    expect(aliases['@fluojs/socket.io']).toBe(join(repoRoot, 'packages', 'platform-socket.io', 'src', 'index.ts'));
    expect(aliases['@fluojs/socket.io/module']).toBe(join(repoRoot, 'packages', 'platform-socket.io', 'src', 'module.ts'));
    expect(aliases).not.toHaveProperty('@fluojs/websocket');
    expect(aliases).not.toHaveProperty('@fluojs/platform-socket.io');
  });
});

const originalShutdownDebugValue = process.env[FLUO_VITEST_SHUTDOWN_DEBUG_ENV];

afterEach(() => {
  if (originalShutdownDebugValue === undefined) {
    delete process.env[FLUO_VITEST_SHUTDOWN_DEBUG_ENV];
    return;
  }

  process.env[FLUO_VITEST_SHUTDOWN_DEBUG_ENV] = originalShutdownDebugValue;
});

describe('createFluoVitestWorkspaceConfig', () => {
  it('keeps shutdown debug hooks disabled by default', () => {
    delete process.env[FLUO_VITEST_SHUTDOWN_DEBUG_ENV];

    const config = createFluoVitestWorkspaceConfig(new URL('../../../', import.meta.url));

    expect(config.test?.reporters).toBeUndefined();
    expect(config.test?.setupFiles).toEqual([expect.stringContaining('symbol-metadata.setup.ts')]);
  });

  it('enables shutdown debug hooks when the CI attribution path is requested', () => {
    process.env[FLUO_VITEST_SHUTDOWN_DEBUG_ENV] = '1';

    const config = createFluoVitestWorkspaceConfig(new URL('../../../', import.meta.url));

    expect(config.test?.reporters).toBeDefined();
    expect(config.test?.reporters).toMatchObject(['default', { onProcessTimeout: expect.any(Function) }]);
    expect(config.test?.setupFiles).toEqual(expect.arrayContaining([expect.stringContaining('symbol-metadata.setup.ts')]));
    expect(config.test?.setupFiles).toEqual(expect.arrayContaining([expect.stringContaining('shutdown-debug.setup.ts')]));
  });
});
