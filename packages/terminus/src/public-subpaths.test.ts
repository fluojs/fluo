import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

type ExportTarget = {
  import: string;
  types: string;
};

describe('@fluojs/terminus subpath exports', () => {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const requiredEmittedArtifacts = [
    '../../core/dist/index.d.ts',
    '../../core/dist/index.js',
    '../../di/dist/index.d.ts',
    '../../di/dist/index.js',
    '../../http/dist/index.d.ts',
    '../../http/dist/index.js',
    '../../runtime/dist/index.d.ts',
    '../../runtime/dist/index.js',
    '../dist/node.d.ts',
    '../dist/node.js',
    '../dist/redis.d.ts',
    '../dist/redis.js',
  ].map((artifact) => new URL(artifact, import.meta.url));

  beforeAll(() => {
    if (requiredEmittedArtifacts.every((artifact) => existsSync(artifact))) {
      return;
    }

    execFileSync('pnpm', ['--filter', '@fluojs/terminus...', 'run', 'build'], {
      cwd: packageRoot,
      killSignal: 'SIGTERM',
      timeout: 60_000,
    });
  }, 60_000);

  it('keeps the node and redis subpaths aligned with emitted dist artifacts', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, ExportTarget>;
    };

    expect(packageJson.exports).toMatchObject({
      './node': {
        import: './dist/node.js',
        types: './dist/node.d.ts',
      },
      './redis': {
        import: './dist/redis.js',
        types: './dist/redis.d.ts',
      },
    });
  });

  it('imports emitted node and redis subpaths with their declarations', () => {
    const declarationFixture = fileURLToPath(new URL('../test-fixtures/public-subpaths-import.ts', import.meta.url));

    expect(() => {
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "const [node, redis] = await Promise.all([import('@fluojs/terminus/node'), import('@fluojs/terminus/redis')]); const exports = [node.MemoryHealthIndicator, node.createMemoryHealthIndicator, node.createMemoryHealthIndicatorProvider, redis.RedisHealthIndicator, redis.createRedisHealthIndicator, redis.createRedisHealthIndicatorProvider]; if (!exports.every((value) => typeof value === 'function')) process.exitCode = 1;",
        ],
        { cwd: packageRoot },
      );
      execFileSync(
        'pnpm',
        [
          'exec',
          'tsc',
          '--noEmit',
          '--ignoreConfig',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--skipLibCheck',
          '--strict',
          '--target',
          'ES2022',
          declarationFixture,
        ],
        { cwd: packageRoot },
      );
    }).not.toThrow();
  });
});
