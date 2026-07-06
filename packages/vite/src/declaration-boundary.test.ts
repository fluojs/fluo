import { readFile } from 'node:fs/promises';
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

  it('keeps the injected Babel test factory out of production declarations', async () => {
    const buildConfig = await readJsonFile(new URL('../tsconfig.build.json', import.meta.url));
    const compilerOptions = readRecordProperty(buildConfig, 'compilerOptions');
    const source = await readFile(new URL('./decorators-plugin.ts', import.meta.url), 'utf8');

    expect(compilerOptions.stripInternal).toBe(true);
    expect(source).toContain('@internal');
    expect(source).toContain('createFluoDecoratorsPluginForTesting');
  });
});
