import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import { fluoBabelDecoratorsPlugin } from '../vitest.js';

function collectSourceEntries(sourceRoot: string): string[] {
  const entries: string[] = [];

  for (const directoryEntry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const entryPath = join(sourceRoot, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      entries.push(...collectSourceEntries(entryPath));
      continue;
    }

    if (directoryEntry.isFile()) {
      entries.push(entryPath);
    }
  }

  return entries;
}

function collectWorkspaceAliasesFromRoot(repoRoot: string): Record<string, string> {
  const packagesRoot = join(repoRoot, 'packages');
  const aliases: Record<string, string> = {};

  for (const packageDirectoryName of readdirSync(packagesRoot)) {
    const packageRoot = join(packagesRoot, packageDirectoryName);
    const sourceRoot = join(packageRoot, 'src');
    const manifestPath = join(packageRoot, 'package.json');

    if (!existsSync(sourceRoot) || !existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
    const scopeName = manifest.name ?? `@fluojs/${packageDirectoryName}`;

    for (const sourceEntryPath of collectSourceEntries(sourceRoot)) {
      const relativeSourceEntry = relative(sourceRoot, sourceEntryPath);

      if (
        extname(sourceEntryPath) !== '.ts' ||
        relativeSourceEntry.endsWith('.test.ts') ||
        relativeSourceEntry === 'index.ts'
      ) {
        continue;
      }

      const subpath = relativeSourceEntry.slice(0, -3).split(sep).join('/');
      aliases[`${scopeName}/${subpath}`] = sourceEntryPath;
    }

    const indexPath = join(sourceRoot, 'index.ts');
    if (existsSync(indexPath)) {
      aliases[scopeName] = indexPath;
    }
  }

  return {
    '@fluojs/runtime/internal/http-adapter': join(packagesRoot, 'runtime', 'src', 'internal-http-adapter.ts'),
    '@fluojs/runtime/internal/request-response-factory': join(
      packagesRoot,
      'runtime',
      'src',
      'internal-request-response-factory.ts',
    ),
    ...aliases,
  };
}

/**
 * Collects source-file aliases for a fluo monorepo checkout.
 *
 * @param repoRootUrl - Repository root as a file URL or absolute path URL string.
 * @returns A Vite/Vitest alias map that points public package imports at workspace source files.
 */
export function collectWorkspaceAliases(repoRootUrl: string | URL): Record<string, string> {
  return collectWorkspaceAliasesFromRoot(fileURLToPath(repoRootUrl));
}

/**
 * Creates the shared Vitest configuration used by fluo workspace packages.
 *
 * @param repoRootUrl - Repository root as a file URL or absolute path URL string.
 * @param overrides - Optional Vitest config overrides merged after the fluo defaults.
 * @returns A Vitest configuration with fluo decorator transforms and workspace aliases.
 */
export function createFluoVitestWorkspaceConfig(repoRootUrl: string | URL, overrides = {}) {
  return mergeConfig(
    defineConfig({
      plugins: [fluoBabelDecoratorsPlugin()],
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

/**
 * Defines a Vitest config rooted at the current fluo repository checkout.
 *
 * @returns A Vitest configuration for repository-local package tests.
 */
export function defineFluoVitestConfig() {
  return createFluoVitestWorkspaceConfig(new URL('../../../../', import.meta.url));
}
