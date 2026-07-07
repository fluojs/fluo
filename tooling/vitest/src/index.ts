import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import { fluoBabelDecoratorsPlugin } from '../../vite/src';
import {
  createFluoVitestShutdownDebugReporter,
  isFluoVitestShutdownDebugEnabled,
} from './shutdown-debug.js';

const runtimeExportConditions = ['import', 'default', 'node', 'browser', 'worker'] as const;
const typeOnlyExportConditions = new Set(['types', 'typings']);
const javascriptExtensions = ['.js', '.mjs', '.cjs'] as const;

type WorkspacePackageManifest = {
  exports?: unknown;
  name?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectExportEntries(exportsField: unknown): Array<[string, unknown]> {
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    return [['.', exportsField]];
  }

  if (!isRecord(exportsField)) {
    return [];
  }

  const entries = Object.entries(exportsField);
  const hasSubpathKeys = entries.some(([subpath]) => subpath === '.' || subpath.startsWith('./'));

  if (!hasSubpathKeys) {
    return [['.', exportsField]];
  }

  return entries.filter(([subpath]) => subpath === '.' || subpath.startsWith('./'));
}

function resolveRuntimeExportTarget(exportTarget: unknown): string | undefined {
  if (typeof exportTarget === 'string') {
    return exportTarget;
  }

  if (Array.isArray(exportTarget)) {
    for (const candidate of exportTarget) {
      const resolvedCandidate = resolveRuntimeExportTarget(candidate);

      if (resolvedCandidate) {
        return resolvedCandidate;
      }
    }

    return undefined;
  }

  if (!isRecord(exportTarget)) {
    return undefined;
  }

  for (const condition of runtimeExportConditions) {
    const resolvedCondition = resolveRuntimeExportTarget(exportTarget[condition]);

    if (resolvedCondition) {
      return resolvedCondition;
    }
  }

  for (const [condition, nestedTarget] of Object.entries(exportTarget)) {
    if (typeOnlyExportConditions.has(condition)) {
      continue;
    }

    const resolvedNestedTarget = resolveRuntimeExportTarget(nestedTarget);

    if (resolvedNestedTarget) {
      return resolvedNestedTarget;
    }
  }

  return undefined;
}

function resolveSourcePathFromExportTarget(packageRoot: string, exportTarget: unknown): string | undefined {
  const runtimeTarget = resolveRuntimeExportTarget(exportTarget);

  if (!runtimeTarget?.startsWith('./dist/')) {
    return undefined;
  }

  for (const extension of javascriptExtensions) {
    if (!runtimeTarget.endsWith(extension)) {
      continue;
    }

    const sourcePath = join(packageRoot, 'src', `${runtimeTarget.slice('./dist/'.length, -extension.length)}.ts`);

    if (existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  return undefined;
}

function toAliasName(packageName: string, exportSubpath: string): string {
  if (exportSubpath === '.') {
    return packageName;
  }

  return `${packageName}/${exportSubpath.slice('./'.length)}`;
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

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspacePackageManifest;
    const scopeName = manifest.name ?? `@fluojs/${packageDirectoryName}`;

    for (const [exportSubpath, exportTarget] of collectExportEntries(manifest.exports)) {
      const sourcePath = resolveSourcePathFromExportTarget(packageRoot, exportTarget);

      if (sourcePath) {
        aliases[toAliasName(scopeName, exportSubpath)] = sourcePath;
      }
    }

    const indexPath = join(sourceRoot, 'index.ts');
    if (existsSync(indexPath)) {
      aliases[scopeName] = indexPath;
    }
  }

  const orderedAliases = {
    '@fluojs/runtime/internal/http-adapter': join(packagesRoot, 'runtime', 'src', 'internal-http-adapter.ts'),
    '@fluojs/runtime/internal/request-response-factory': join(
      packagesRoot,
      'runtime',
      'src',
      'internal-request-response-factory.ts',
    ),
    ...aliases,
  };

  return Object.fromEntries(
    Object.entries(orderedAliases).sort(([leftAlias], [rightAlias]) => rightAlias.length - leftAlias.length),
  );
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
