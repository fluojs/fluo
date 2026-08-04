import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTypegenCommand } from './typegen.js';
import type { ReactTypegenModules } from './typegen-source.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen module loader override', () => {
  it.each(['ts', 'js', 'mjs'] as const)('uses caller-supplied modules for a .%s application', async (extension) => {
    // Given: a module loader whose output differs from the default package namespaces.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-typegen-loader-override-'));
    tempDirectories.push(cwd);
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}\n', 'utf8');
    const modulePath = join(cwd, `app.${extension}`);
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    const expectedSource = `// caller-supplied ${extension} typegen source\n`;
    await writeFile(modulePath, 'export class AppModule {}\n', 'utf8');
    const close = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({
      close,
      dispatcher: { describeRoutes: () => [{ id: `override-${extension}` }] },
    }));
    const modules = {
      react: { createReactPageCatalog: (descriptors: readonly object[]) => descriptors },
      runtime: { FluoFactory: Object.assign(() => undefined, { create }) },
      typegen: { generateReactPageTypes: () => expectedSource },
    } satisfies ReactTypegenModules;
    const loadReactTypegenModules = vi.fn(async () => modules);
    const stderr: string[] = [];

    // When: the programmatic command generates from that application extension.
    const exitCode = await runTypegenCommand([modulePath, '--output', outputPath], {
      cwd,
      loadReactTypegenModules,
      stderr: { write: (message) => stderr.push(message) },
      stdout: { write: () => undefined },
    });

    // Then: generation preserves the caller's namespace identity instead of loading defaults.
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(loadReactTypegenModules).toHaveBeenCalledExactlyOnceWith(cwd);
    expect(create).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(await readFile(outputPath, 'utf8')).toBe(expectedSource);
  });
});
