import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);

describe('@fluojs/platform-deno declaration surface', () => {
  it('keeps zero-argument adapter construction in the manifest-exported declarations', async () => {
    // Given: the package manifest publishes its root declarations from dist/index.d.ts.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          types: './dist/index.d.ts',
        },
      },
    });

    // When: publication declaration outputs are generated when a prior build is unavailable.
    if (!existsSync(resolve(packageRootPath, 'dist/adapter.d.ts'))) {
      await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/platform-deno'], {
        cwd: repoRootPath,
        env: process.env,
      });
    }

    // Then: the exported root reaches an adapter declaration whose options argument is optional.
    expect(readFileSync(resolve(packageRootPath, 'dist/index.d.ts'), 'utf8')).toContain(
      "export * from './adapter.js';",
    );
    expect(readFileSync(resolve(packageRootPath, 'dist/adapter.d.ts'), 'utf8')).toContain(
      'constructor(options?: DenoAdapterOptions);',
    );
  }, 300_000);
});
