import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const cliPath = join(fixturesDirectory, '../cli.ts');
const tsxImport = createRequire(import.meta.url).resolve('tsx');
const tempDirectories: string[] = [];

function nativeApplicationSource(): string {
  return [
    "import { defineModule } from '@fluojs/runtime';",
    "import { ReactModule } from '@fluojs/react';",
    "import { ProductRouter } from './router.mjs';",
    '',
    'export class AppModule {}',
    'defineModule(AppModule, { imports: [ReactModule.forRoot({ controllers: [ProductRouter] })] });',
    '',
  ].join('\n');
}

function nativeRouterSource(basePath: string): string {
  return [
    "import { Path, Router } from '@fluojs/react';",
    '',
    'export class ProductRouter {',
    '  show() {}',
    '}',
    "Path('/:productId')(ProductRouter.prototype, 'show', Object.getOwnPropertyDescriptor(ProductRouter.prototype, 'show'));",
    `Router(${JSON.stringify(basePath)})(ProductRouter);`,
    '',
  ].join('\n');
}

function waitForAnyOutput(child: ChildProcess, output: string[], expected: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected.join(' or ')}. Output:\n${output.join('')}`));
    }, 15_000);
    const inspect = () => {
      const current = output.join('');
      const matched = expected.find((candidate) => current.includes(candidate));
      if (matched !== undefined) {
        cleanup();
        resolve(matched);
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Typegen process exited with ${String(code)} before ${expected.join(' or ')}. Output:\n${output.join('')}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', inspect);
      child.stderr?.off('data', inspect);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('exit', onExit);
    inspect();
  });
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen native module process lifecycle', () => {
  it('reloads an imported native ESM router during watch regeneration', async () => {
    // Given: a native application whose route metadata lives in a statically imported MJS child.
    const cwd = await mkdtemp(join(fixturesDirectory, 'typegen-native-watch-process-'));
    tempDirectories.push(cwd);
    const modulePath = join(cwd, 'app.mjs');
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    const routerPath = join(cwd, 'router.mjs');
    await writeFile(modulePath, nativeApplicationSource(), 'utf8');
    await writeFile(routerPath, nativeRouterSource('/products'), 'utf8');
    const output: string[] = [];
    const child = spawn(process.execPath, [
      '--import',
      tsxImport,
      cliPath,
      'typegen',
      modulePath,
      '--output',
      outputPath,
      '--watch',
      '--no-update-check',
    ], {
      cwd: join(fixturesDirectory, '../../../..'),
      env: { ...process.env, TSX_TSCONFIG_PATH: join(fixturesDirectory, 'tsconfig.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

    try {
      await waitForAnyOutput(child, output, [`WATCHING ${cwd}`]);
      expect(await readFile(outputPath, 'utf8')).toContain('/products/:productId');
      output.length = 0;

      // When: only the imported native router module changes.
      await writeFile(routerPath, nativeRouterSource('/inventory'), 'utf8');
      await waitForAnyOutput(child, output, [`UPDATE ${outputPath}`]);

      // Then: watch generation imports a fresh native dependency graph and publishes current routes.
      expect(await readFile(outputPath, 'utf8')).toContain('/inventory/:productId');
      expect(await readFile(outputPath, 'utf8')).not.toContain('/products/:productId');
    } finally {
      child.kill('SIGTERM');
      if (child.exitCode === null) {
        await new Promise<number | null>((resolve) => child.once('exit', resolve));
      }
    }
  }, 30_000);
});
