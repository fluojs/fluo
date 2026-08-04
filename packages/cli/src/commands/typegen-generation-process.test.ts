import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { runTypegenCommand } from './typegen.js';

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const cliRoot = join(fixturesDirectory, '../..');
const tempDirectories: string[] = [];

function applicationSource(markerPath: string): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { defineModule } from '@fluojs/runtime';",
    "import { Path, ReactModule, Router } from '@fluojs/react';",
    '',
    `writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));`,
    'export class ProductRouter { show() {} }',
    "Path('/:productId')(ProductRouter.prototype, 'show', Object.getOwnPropertyDescriptor(ProductRouter.prototype, 'show'));",
    "Router('/products')(ProductRouter);",
    'export class AppModule {}',
    'defineModule(AppModule, { imports: [ReactModule.forRoot({ controllers: [ProductRouter] })] });',
    '',
  ].join('\n');
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen generation process', () => {
  it('settles every isolated generation process before repeated commands complete', async () => {
    // Given: one native application generated repeatedly in a long-lived caller process.
    const cwd = await mkdtemp(join(fixturesDirectory, 'typegen-generation-process-'));
    tempDirectories.push(cwd);
    const markerPath = join(cwd, 'generation.pid');
    const modulePath = join(cwd, 'app.mjs');
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    await writeFile(modulePath, applicationSource(markerPath), 'utf8');

    // When: the caller completes many default generations.
    for (let generation = 0; generation < 12; generation += 1) {
      const stderr: string[] = [];
      const exitCode = await runTypegenCommand([modulePath, '--output', outputPath], {
        cwd: cliRoot,
        stderr: { write: (message) => stderr.push(message) },
        stdout: { write: () => undefined },
      });

      // Then: command completion observes current output with no retained generation process.
      expect(stderr).toEqual([]);
      expect(exitCode).toBe(0);
      const generationPid = Number.parseInt(await readFile(markerPath, 'utf8'), 10);
      expect(generationPid).not.toBe(process.pid);
      expect(isProcessRunning(generationPid)).toBe(false);
    }
    expect(await readFile(outputPath, 'utf8')).toContain('/products/:productId');
  }, 60_000);
});
