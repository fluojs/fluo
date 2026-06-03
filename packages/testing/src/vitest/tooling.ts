import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vitest/config';

import { fluoBabelDecoratorsPlugin } from '../vitest.js';

const workspaceAliasCache = new Map<string, Record<string, string>>();

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
    const manifestPath = join(packageRoot, 'package.json');

    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspacePackageManifest;
    const packageName = manifest.name ?? `@fluojs/${packageDirectoryName}`;
    const exportAliases = collectExportEntries(manifest.exports)
      .map(([exportSubpath, exportTarget]) => {
        const sourcePath = resolveSourcePathFromExportTarget(packageRoot, exportTarget);

        return sourcePath ? { aliasName: toAliasName(packageName, exportSubpath), sourcePath } : undefined;
      })
      .filter((entry): entry is { aliasName: string; sourcePath: string } => entry !== undefined)
      .sort((left, right) => right.aliasName.length - left.aliasName.length);

    for (const { aliasName, sourcePath } of exportAliases) {
      aliases[aliasName] = sourcePath;
    }
  }

  return aliases;
}

/**
 * Collects package-export aliases for a fluo monorepo checkout.
 *
 * @param repoRootUrl - Repository root as a file URL or absolute path URL string.
 * @returns A Vite/Vitest alias map that points exported package imports at workspace source files.
 */
export function collectWorkspaceAliases(repoRootUrl: string | URL): Record<string, string> {
  const repoRoot = fileURLToPath(repoRootUrl);
  const cachedAliases = workspaceAliasCache.get(repoRoot);

  if (cachedAliases) {
    return { ...cachedAliases };
  }

  const aliases = collectWorkspaceAliasesFromRoot(repoRoot);
  workspaceAliasCache.set(repoRoot, aliases);

  return { ...aliases };
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
