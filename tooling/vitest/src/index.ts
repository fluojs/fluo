import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type UserConfig } from 'vitest/config';

import { fluoBabelDecoratorsPlugin } from '../../vite/src';
import {
  createFluoVitestShutdownDebugReporter,
  isFluoVitestShutdownDebugEnabled,
} from './shutdown-debug.js';

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

export function createFluoVitestWorkspaceConfig(repoRootUrl: string | URL, overrides: UserConfig = {}) {
  const repoRoot = fileURLToPath(repoRootUrl);
  const shutdownDebugEnabled = isFluoVitestShutdownDebugEnabled();
  const shutdownDebugConfig = shutdownDebugEnabled
    ? {
        reporters: ['default', createFluoVitestShutdownDebugReporter(repoRoot)],
        setupFiles: [fileURLToPath(new URL('./shutdown-debug.setup.ts', import.meta.url))],
      }
    : {};

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
