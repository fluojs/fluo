import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const declarationRootPath = resolve(packageRootPath, 'dist/index.d.ts');
const declarationTypesPath = resolve(packageRootPath, 'dist/types.d.ts');
const requiredArtifactPaths = [declarationRootPath, declarationTypesPath] as const;

/**
 * Typechecks the published root declaration the way a strict consumer without Node
 * ambient types does: `types: []` removes every automatically included `@types/*`
 * package, so any leaked `NodeJS.*` reference fails to resolve.
 */
function collectCleanConsumerDiagnostics(): readonly ts.Diagnostic[] {
  const consumerEntryPath = resolve(packageRootPath, 'dist/__fluo-clean-consumer__.ts');
  const consumerEntrySource = [
    "import type { ConfigModuleOptions } from './index.js';",
    '',
    'export const processEnv: ConfigModuleOptions[\'processEnv\'] = { PORT: \'3000\', UNSET: undefined };',
    '',
  ].join('\n');
  const compilerOptions: ts.CompilerOptions = {
    declaration: false,
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    // A clean consumer has no ambient Node types available.
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

  const program = ts.createProgram([consumerEntryPath], compilerOptions, host);

  return ts.getPreEmitDiagnostics(program);
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (filePath) => filePath,
    getCurrentDirectory: () => repoRootPath,
    getNewLine: () => '\n',
  });
}

describe('@fluojs/config published declaration consumer surface', () => {
  beforeAll(async () => {
    if (requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/config'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('does not declare @types/node as a dependency or peer dependency', () => {
    // Given: the manifest publishes root declarations without any Node types contract.
    const manifest = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly peerDependencies?: Record<string, string>;
    };

    // Then: consumers never inherit ambient Node types from this package.
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@types/node');
    expect(manifest.peerDependencies ?? {}).not.toHaveProperty('@types/node');
  });

  it('typechecks the published root declaration without ambient Node types', () => {
    // Given: a strict consumer program compiled with `types: []`.
    // When: the published root declaration is resolved through the package entry.
    const diagnostics = collectCleanConsumerDiagnostics();

    // Then: no declaration member depends on an unresolvable ambient Node namespace.
    expect(formatDiagnostics(diagnostics)).toBe('');
  }, 60_000);

  it('keeps the published process-env option structurally self-contained', () => {
    // Given: the emitted root declaration graph, ignoring documentation prose.
    const declarationSourceFile = ts.createSourceFile(
      declarationTypesPath,
      readFileSync(declarationTypesPath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declarationCode = ts
      .createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
      .printFile(declarationSourceFile);

    // Then: the option is expressed with package-owned structural types only.
    expect(declarationCode).not.toMatch(/\bNodeJS\b/);
    expect(declarationCode).toContain('processEnv?: ConfigProcessEnv;');
    expect(declarationCode).toContain('type ConfigProcessEnv = Record<string, string | undefined>;');
  });
});
