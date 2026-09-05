import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const rejectNodeBuiltinsLoaderPath = fileURLToPath(
  new URL('./reject-node-builtins-loader.test-fixture.mjs', import.meta.url),
);

function collectProductionTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectProductionTypeScript(path);
    }

    return extname(path) === '.ts' && !path.endsWith('.test.ts') && !path.endsWith('.test-fixture.ts')
      ? [path]
      : [];
  });
}

describe('@fluojs/runtime portable package boundary', () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/runtime'], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    });
  }, 120_000);

  it('imports the published root under Bun conditions without resolving Node builtins', async () => {
    const result = await execFileAsync(
      process.execPath,
      [
        '--conditions=bun',
        `--experimental-loader=${rejectNodeBuiltinsLoaderPath}`,
        '--input-type=module',
        '--eval',
        "import('@fluojs/runtime')",
      ],
      { cwd: fileURLToPath(new URL('..', import.meta.url)) },
    );

    expect(result.stdout).toBe('');
  });

  it('publishes no Node engine or Node-only entrypoint', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      devDependencies?: Record<string, string>;
      engines?: { node?: string };
      exports: Record<string, unknown>;
    };

    expect(manifest.engines?.node).toBeUndefined();
    expect(manifest.devDependencies).not.toHaveProperty('@fluojs/platform-nodejs');
    expect(manifest.exports).not.toHaveProperty('./node');
    expect(manifest.exports).not.toHaveProperty('./internal-node');
  });

  it('preserves every intentional runtime-neutral engine omission', () => {
    for (const packageName of [
      'email',
      'i18n',
      'platform-bun',
      'platform-cloudflare-workers',
      'platform-deno',
      'react',
    ]) {
      const manifest = JSON.parse(
        readFileSync(new URL(`../../${packageName}/package.json`, import.meta.url), 'utf8'),
      ) as { engines?: { node?: string } };

      expect(manifest.engines?.node, packageName).toBeUndefined();
    }
  });

  it('contains no eager Node builtin imports in published production source', () => {
    const sourceRoot = new URL('.', import.meta.url);
    const eagerNodeImports = collectProductionTypeScript(sourceRoot.pathname).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return /(?:from\s+|import\s*\()['"]node:/u.test(source) ? [path] : [];
    });

    expect(eagerNodeImports).toEqual([]);
  });
});
