import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

import { konektiBabelDecoratorsPlugin } from './tooling/vite/src';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');

function collectWorkspaceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const packageName of readdirSync(PACKAGES_ROOT)) {
    const packageRoot = join(PACKAGES_ROOT, packageName);
    const sourceRoot = join(packageRoot, 'src');
    const scopeName = `@konekti/${packageName}`;

    const indexPath = join(sourceRoot, 'index.ts');
    if (existsSync(indexPath)) {
      aliases[scopeName] = indexPath;
    }

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
  }

  return aliases;
}

export default defineConfig({
  resolve: {
    alias: collectWorkspaceAliases(),
  },
  plugins: [konektiBabelDecoratorsPlugin()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'packages',
          exclude: [...configDefaults.exclude, 'packages/cli/.sandbox/**'],
          include: ['packages/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'apps',
          exclude: configDefaults.exclude,
          include: ['apps/**/*.test.ts'],
        },
      },
    ],
    environment: 'node',
  },
});
