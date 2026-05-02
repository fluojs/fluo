import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import { fluoBabelDecoratorsPlugin } from '../../vite/src';
import {
  createFluoVitestShutdownDebugReporter,
  isFluoVitestShutdownDebugEnabled,
} from './shutdown-debug.js';

function collectWorkspaceAliasesFromRoot(repoRoot: string): Record<string, string> {
  const packagesRoot = join(repoRoot, 'packages');
  const aliases: Record<string, string> = {};

  const collectSourceEntries = (sourceRoot: string): string[] => {
    const entries: string[] = [];

    for (const directoryEntry of readdirSync(sourceRoot, { withFileTypes: true })) {
      const entryPath = join(sourceRoot, directoryEntry.name);

      if (directoryEntry.isDirectory()) {
        entries.push(...collectSourceEntries(entryPath));
        continue;
      }

      if (!directoryEntry.isFile()) {
        continue;
      }

      entries.push(entryPath);
    }

    return entries;
  };

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

export function collectWorkspaceAliases(repoRootUrl: string | URL): Record<string, string> {
  return collectWorkspaceAliasesFromRoot(fileURLToPath(repoRootUrl));
}

export function createFluoVitestWorkspaceConfig(repoRootUrl: string | URL, overrides = {}) {
  const repoRoot = fileURLToPath(repoRootUrl);
  const shutdownDebugEnabled = isFluoVitestShutdownDebugEnabled();
  const symbolMetadataSetupFile = fileURLToPath(new URL('./symbol-metadata.setup.ts', import.meta.url));
  const shutdownDebugConfig = shutdownDebugEnabled
    ? {
        reporters: ['default', createFluoVitestShutdownDebugReporter(repoRoot)],
        setupFiles: [symbolMetadataSetupFile, fileURLToPath(new URL('./shutdown-debug.setup.ts', import.meta.url))],
      }
    : {
        setupFiles: [symbolMetadataSetupFile],
      };

  return mergeConfig(
    defineConfig({
      plugins: [fluoBabelDecoratorsPlugin()],
      resolve: {
        alias: collectWorkspaceAliases(repoRootUrl),
      },
      test: {
        environment: 'node',
        ...shutdownDebugConfig,
      },
    }),
    defineConfig(overrides),
  );
}

export function defineFluoVitestConfig() {
  return createFluoVitestWorkspaceConfig(new URL('../../../', import.meta.url));
}
