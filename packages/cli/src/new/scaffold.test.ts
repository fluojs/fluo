import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldBootstrapApp } from './scaffold.js';
import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('scaffoldBootstrapApp', () => {
  it('generates TS6 starter configs without deprecated baseUrl aliases', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsconfig = readFileSync(join(targetDirectory, 'tsconfig.json'), 'utf8');
    const tsconfigBuild = readFileSync(join(targetDirectory, 'tsconfig.build.json'), 'utf8');
    const viteConfig = readFileSync(join(targetDirectory, 'vite.config.ts'), 'utf8');
    const vitestConfig = readFileSync(join(targetDirectory, 'vitest.config.ts'), 'utf8');

    expect(packageJson.devDependencies?.typescript).toBe('^6.0.2');
    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/http': expect.any(String),
      '@fluojs/platform-fastify': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(tsconfig).not.toContain('baseUrl');
    expect(tsconfigBuild).not.toContain('baseUrl');
    expect(viteConfig).toContain("import { defineConfig } from 'vite';");
    expect(viteConfig).not.toContain('baseUrl');
    expect(vitestConfig).toContain("import { fluoBabelDecoratorsPlugin } from '@fluojs/testing/vitest';");
    expect(vitestConfig).not.toContain('baseUrl');
  });
});
