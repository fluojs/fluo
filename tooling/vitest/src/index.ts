import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type UserConfig } from 'vitest/config';

import { konektiBabelDecoratorsPlugin } from '../../vite/src';

function collectWorkspaceAliasesFromRoot(repoRoot: string): Record<string, string> {
  const packagesRoot = join(repoRoot, 'packages');
  const aliases: Record<string, string> = {};

  for (const packageName of readdirSync(packagesRoot)) {
    const packageRoot = join(packagesRoot, packageName);
    const sourceRoot = join(packageRoot, 'src');
    const scopeName = `@konekti/${packageName}`;

    if (!existsSync(sourceRoot)) {
      continue;
    }

    for (const sourceEntry of readdirSync(sourceRoot)) {
      if (extname(sourceEntry) !== '.ts' || sourceEntry.endsWith('.test.ts') || sourceEntry === 'index.ts') {
        continue;
      }

      const subpath = sourceEntry.slice(0, -3);
      aliases[`${scopeName}/${subpath}`] = join(sourceRoot, sourceEntry);
    }

    const indexPath = join(sourceRoot, 'index.ts');
    if (existsSync(indexPath)) {
      aliases[scopeName] = indexPath;
    }
  }

  return {
    '@konekti/runtime/internal/http-adapter': join(packagesRoot, 'runtime', 'src', 'internal-http-adapter.ts'),
    '@konekti/runtime/internal/request-response-factory': join(
      packagesRoot,
      'runtime',
      'src',
      'internal-request-response-factory.ts',
    ),
    ...aliases,
  };
}

export function collectWorkspaceAliases(repoRootUrl: string | URL): Record<string, string> {
  return collectWorkspaceAliasesFromRoot(fileURLToPath(repoRootUrl));
}

export function createKonektiVitestWorkspaceConfig(repoRootUrl: string | URL, overrides: UserConfig = {}) {
  return mergeConfig(
    defineConfig({
      plugins: [konektiBabelDecoratorsPlugin()],
      resolve: {
        alias: collectWorkspaceAliases(repoRootUrl),
      },
      test: {
        environment: 'node',
      },
    }),
    defineConfig(overrides),
  );
}

export function defineKonektiVitestConfig() {
  return createKonektiVitestWorkspaceConfig(new URL('../../../', import.meta.url));
}
