import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const builtEntryPointPath = resolve(packageRootPath, 'dist/index.js');
const declarationEntryPointPath = resolve(packageRootPath, 'dist/index.d.ts');
const packageManifestPath = resolve(packageRootPath, 'package.json');
const lockfilePath = resolve(repoRootPath, 'pnpm-lock.yaml');
const removedPublicSurfaces = [
  'DrizzleTransactionInterceptor',
  'createDrizzleDatabaseFacade',
  'createDrizzleProviders',
  'createDrizzleProvidersAsync',
  'DRIZZLE_NORMALIZED_OPTIONS',
  'normalizeDrizzleModuleOptions',
] as const;

function parsePnpmImporterDependencies(lockfile: string, importerPath: string): ReadonlySet<string> {
  const lines = lockfile.split('\n');
  const importerIndex = lines.indexOf(`  ${importerPath}:`);

  if (importerIndex === -1) {
    throw new Error(`Missing ${importerPath} importer in pnpm-lock.yaml.`);
  }

  const dependencies = new Set<string>();
  let inDependencies = false;

  for (const line of lines.slice(importerIndex + 1)) {
    if (/^[ ]{2}\S/.test(line)) break;

    if (line === '    dependencies:') {
      inDependencies = true;
      continue;
    }

    if (/^[ ]{4}\S/.test(line)) {
      inDependencies = false;
      continue;
    }

    if (!inDependencies) continue;

    const match = /^[ ]{6}(?:(?<quoted>'[^']+')|(?<plain>[^:]+)):$/.exec(line);
    const dependencyName = match?.groups?.quoted ?? match?.groups?.plain;

    if (dependencyName) {
      dependencies.add(dependencyName.replace(/^'|'$/g, ''));
    }
  }

  return dependencies;
}

function collectRemovedDeclarationImportDiagnostics(surface: string): readonly ts.Diagnostic[] {
  const consumerEntryPath = resolve(packageRootPath, 'dist/__fluo-removed-public-consumer__.ts');
  const consumerEntrySource = [
    `import { ${surface} } from './index.js';`,
    '',
  ].join('\n');
  const compilerOptions: ts.CompilerOptions = {
    declaration: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = ((fileName: string) =>
    resolve(fileName) === consumerEntryPath || ts.sys.fileExists(fileName)) as typeof host.fileExists;
  host.readFile = ((fileName: string) =>
    resolve(fileName) === consumerEntryPath ? consumerEntrySource : ts.sys.readFile(fileName)) as typeof host.readFile;
  host.getSourceFile = ((fileName: string, languageVersionOrOptions, ...rest) =>
    resolve(fileName) === consumerEntryPath
      ? ts.createSourceFile(fileName, consumerEntrySource, languageVersionOrOptions, true, ts.ScriptKind.TS)
      : originalGetSourceFile(fileName, languageVersionOrOptions, ...rest)) as typeof host.getSourceFile;

  return ts.getPreEmitDiagnostics(ts.createProgram([consumerEntryPath], compilerOptions, host));
}

describe('@fluojs/drizzle published artifact surface', () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/drizzle'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('does not emit removed or internal public surfaces from a cold build', () => {
    const builtJavaScript = readFileSync(builtEntryPointPath, 'utf8');
    const declarationEntryPoint = readFileSync(declarationEntryPointPath, 'utf8');

    for (const surface of removedPublicSurfaces) {
      expect(builtJavaScript).not.toContain(surface);
      expect(declarationEntryPoint).not.toContain(surface);
    }
  });

  it('rejects declaration imports of removed and internal public surfaces', () => {
    for (const surface of removedPublicSurfaces) {
      const diagnostics = collectRemovedDeclarationImportDiagnostics(surface);

      expect(diagnostics.some((diagnostic) => diagnostic.code === 2305 || diagnostic.code === 2724)).toBe(true);
    }
  });

  it('does not declare @fluojs/http as a production Drizzle dependency', () => {
    const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as {
      dependencies?: Readonly<Record<string, string>>;
    };
    const importerDependencies = parsePnpmImporterDependencies(
      readFileSync(lockfilePath, 'utf8'),
      'packages/drizzle',
    );

    expect(packageManifest.dependencies).not.toHaveProperty('@fluojs/http');
    expect(importerDependencies).not.toContain('@fluojs/http');
  });
});
