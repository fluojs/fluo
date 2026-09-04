import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonFile(path: URL): Promise<Record<string, unknown>> {
  const content = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(content);

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${path.pathname} to contain a JSON object.`);
  }

  return parsed;
}

function readRecordProperty(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];

  if (!isRecord(value)) {
    throw new Error(`Expected ${key} to contain a JSON object.`);
  }

  return value;
}

function readStringArrayProperty(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Expected ${key} to contain a string array.`);
  }

  return value;
}

describe('Vite package declaration boundary', () => {
  it('keeps package build outputs aligned with the documented test/spec skip contract', async () => {
    const packageJson = await readJsonFile(new URL('../package.json', import.meta.url));
    const buildConfig = await readJsonFile(new URL('../tsconfig.build.json', import.meta.url));
    const scripts = readRecordProperty(packageJson, 'scripts');

    expect(scripts.build).toContain("--ignore 'src/**/*.test.ts','src/**/*.spec.ts'");
    expect(readStringArrayProperty(buildConfig, 'exclude')).toEqual(['src/**/*.test.ts', 'src/**/*.spec.ts']);
  });

  it(
    'keeps the injected Babel test factory out of production declarations',
    async () => {
      const outputDirectory = await mkdtemp(join(tmpdir(), 'fluo-vite-declarations-'));

      try {
        await promisify(execFile)(
          process.execPath,
          [
            fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
            '--project',
            'tsconfig.build.json',
            '--outDir',
            outputDirectory,
          ],
          { cwd: new URL('../', import.meta.url) },
        );

        const declaration = await readFile(join(outputDirectory, 'decorators-plugin.d.ts'), 'utf8');

        expect(declaration).not.toContain('createFluoDecoratorsPluginForTesting');
      } finally {
        await rm(outputDirectory, { force: true, recursive: true });
      }
    },
    10_000,
  );
});
