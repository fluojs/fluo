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

async function runTypegenProcess(argv: readonly string[], tsconfigPath: string): Promise<{
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const child = spawn(process.execPath, ['--import', tsxImport, cliPath, ...argv], {
    cwd: join(fixturesDirectory, '../../../..'),
    env: { ...process.env, TSX_TSCONFIG_PATH: tsconfigPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr: Buffer[] = [];
  const stdout: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  return {
    exitCode,
    stderr: Buffer.concat(stderr).toString(),
    stdout: Buffer.concat(stdout).toString(),
  };
}

function applicationSource(basePath: string): string {
  return [
    "import { defineModule } from '@fluojs/runtime';",
    "import { Path, ReactModule, Router } from '@fluojs/react';",
    '',
    `@Router(${JSON.stringify(basePath)})`,
    'class ProductRouter {',
    "  @Path('/:productId')",
    '  show(): void {}',
    '}',
    '',
    'export class AppModule {}',
    'defineModule(AppModule, { imports: [ReactModule.forRoot({ controllers: [ProductRouter] })] });',
    '',
  ].join('\n');
}

function importedApplicationSource(): string {
  return [
    "import { defineModule } from '@fluojs/runtime';",
    "import { ReactModule } from '@fluojs/react';",
    "import { ProductRouter } from './router.js';",
    '',
    'export class AppModule {}',
    'defineModule(AppModule, { imports: [ReactModule.forRoot({ controllers: [ProductRouter] })] });',
    '',
  ].join('\n');
}

function routerSource(basePath: string): string {
  return [
    "import { Path, Router } from '@fluojs/react';",
    '',
    `@Router(${JSON.stringify(basePath)})`,
    'export class ProductRouter {',
    "  @Path('/:productId')",
    '  show(): void {}',
    '}',
    '',
  ].join('\n');
}

function waitForOutput(child: ChildProcess, output: string[], expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}. Output:\n${output.join('')}`));
    }, 15_000);
    const inspect = () => {
      if (output.join('').includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Typegen process exited with ${String(code)} before ${expected}. Output:\n${output.join('')}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', inspect);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', inspect);
    child.once('exit', onExit);
    inspect();
  });
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen process lifecycle', () => {
  it('returns the documented stale exit code from a real non-mutating check process', async () => {
    // Given: a real CLI process has generated an artifact that is then made stale without changing its schema.
    const cwd = await mkdtemp(join(fixturesDirectory, 'typegen-check-process-'));
    tempDirectories.push(cwd);
    const modulePath = join(cwd, 'app.ts');
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    const tsconfigPath = join(cwd, 'tsconfig.json');
    await writeFile(modulePath, applicationSource('/products'), 'utf8');
    const fixtureTsconfig = await readFile(join(fixturesDirectory, 'tsconfig.json'), 'utf8');
    await writeFile(tsconfigPath, fixtureTsconfig.replaceAll('../../../../', '../../../../../'), 'utf8');
    const generated = await runTypegenProcess([
      'typegen', modulePath, '--output', outputPath, '--no-update-check',
    ], tsconfigPath);
    expect(generated.exitCode).toBe(0);
    const stale = (await readFile(outputPath, 'utf8')).replaceAll('/products', '/stale-products');
    await writeFile(outputPath, stale, 'utf8');

    // When: CI invokes the binary-facing check mode.
    const checked = await runTypegenProcess([
      'typegen', modulePath, '--output', outputPath, '--check', '--no-update-check',
    ], tsconfigPath);

    // Then: the process exits with STALE=3, writes only an actionable error, and preserves the target.
    expect(checked.exitCode).toBe(3);
    expect(checked.stdout).toBe('');
    expect(checked.stderr).toContain(`STALE ${outputPath}`);
    expect(await readFile(outputPath, 'utf8')).toBe(stale);
  }, 30_000);

  it('reloads changed page metadata and exits cleanly on SIGTERM', async () => {
    // Given: a standalone TypeScript application module watched by the real CLI process.
    const cwd = await mkdtemp(join(fixturesDirectory, 'typegen-watch-process-'));
    tempDirectories.push(cwd);
    const modulePath = join(cwd, 'app.ts');
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    const routerPath = join(cwd, 'router.ts');
    await writeFile(modulePath, importedApplicationSource(), 'utf8');
    await writeFile(routerPath, routerSource('/products'), 'utf8');
    const fixtureTsconfig = await readFile(join(fixturesDirectory, 'tsconfig.json'), 'utf8');
    await writeFile(
      join(cwd, 'tsconfig.json'),
      fixtureTsconfig.replaceAll('../../../../', '../../../../../'),
      'utf8',
    );
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
      env: { ...process.env, TSX_TSCONFIG_PATH: join(cwd, 'tsconfig.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

    try {
      await waitForOutput(child, output, `WATCHING ${cwd}`);

      // When: the authoritative module changes and the parent sends terminal shutdown.
      await writeFile(routerPath, routerSource('/inventory'), 'utf8');
      await waitForOutput(child, output, `UPDATE ${outputPath}`);
      child.kill('SIGTERM');
      const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));

      // Then: a fresh bootstrap publishes the changed catalog and the watcher exits successfully.
      expect(exitCode).toBe(0);
      expect(await readFile(outputPath, 'utf8')).toContain('/inventory/:productId');
      expect(await readFile(outputPath, 'utf8')).not.toContain('/products/:productId');
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, 30_000);
});
