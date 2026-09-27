import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDirectory = join(repositoryRoot, 'packages/vite/test-fixtures/babel8');
const isolatedRoot = mkdtempSync(join(tmpdir(), 'fluo-babel8-'));
const { transformFileSync } = createRequire(import.meta.url)('@babel/core');

try {
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    copyFileSync(join(fixtureDirectory, name), join(isolatedRoot, name));
  }

  execFileSync('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace'], {
    cwd: isolatedRoot,
    stdio: 'pipe',
  });

  const compile = (source, target) => {
    const result = transformFileSync(source, {
      babelrc: false,
      configFile: false,
      filename: source,
      presets: ['@babel/preset-typescript'],
      plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
    });
    if (!result?.code) {
      throw new Error(`Failed to compile Babel 8 regression fixture source: ${source}`);
    }
    writeFileSync(target, result.code);
  };

  const vitePackage = join(isolatedRoot, 'node_modules/@fluojs/vite');
  mkdirSync(join(vitePackage, 'dist'), { recursive: true });
  copyFileSync(join(repositoryRoot, 'packages/vite/package.json'), join(vitePackage, 'package.json'));
  for (const name of ['index', 'decorators-plugin']) {
    compile(join(repositoryRoot, `packages/vite/src/${name}.ts`), join(vitePackage, `dist/${name}.js`));
  }
  compile(
    join(repositoryRoot, 'packages/platform-nextjs/src/decorators-transform.ts'),
    join(isolatedRoot, 'decorators-transform.mjs'),
  );

  process.stdout.write(isolatedRoot);
} catch (error) {
  rmSync(isolatedRoot, { recursive: true, force: true });
  throw error;
}
