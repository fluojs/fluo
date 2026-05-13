import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';

import { fluoDecoratorsPlugin } from './index.js';

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

function runTransform(plugin: Plugin, code: string, id: string): unknown {
  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable transform hook.');
  }

  return Reflect.apply(plugin.transform, {}, [code, id]);
}

describe('fluoDecoratorsPlugin', () => {
  it('skips generated test files', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.test.ts')).resolves.toBeNull();
  });

  it('keeps package build outputs aligned with the documented test/spec skip contract', async () => {
    const packageJson = await readJsonFile(new URL('../package.json', import.meta.url));
    const buildConfig = await readJsonFile(new URL('../tsconfig.build.json', import.meta.url));
    const scripts = readRecordProperty(packageJson, 'scripts');

    expect(scripts.build).toContain("--ignore 'src/**/*.test.ts','src/**/*.spec.ts'");
    expect(readStringArrayProperty(buildConfig, 'exclude')).toEqual(['src/**/*.test.ts', 'src/**/*.spec.ts']);
  });

  it('keeps the Vite transform boundary on application TypeScript files', async () => {
    const plugin = fluoDecoratorsPlugin();

    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/app.spec.ts')).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/types.d.ts')).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', '/app/node_modules/dependency/index.ts'),
    ).resolves.toBeNull();
    await expect(
      runTransform(plugin, 'export const value: number = 1;', 'C:\\app\\node_modules\\dependency\\index.ts'),
    ).resolves.toBeNull();
    await expect(runTransform(plugin, 'export const value: number = 1;', '/app/src/component.tsx')).resolves.toBeNull();
  });

  it('transforms TypeScript files with standard decorators through Babel', async () => {
    const plugin = fluoDecoratorsPlugin();
    const result = await runTransform(
      plugin,
      `function logged(value: unknown, context: ClassMethodDecoratorContext) {
  context.name;
}

class Example {
  @logged
  greet(): string {
    return 'hello';
  }
}

export { Example };
`,
      '/app/src/example.ts',
    );

    expect(result).toEqual(expect.objectContaining({ code: expect.any(String) }));
    expect(result && typeof result === 'object' && 'code' in result ? result.code : '').not.toContain(': string');
  });
});
