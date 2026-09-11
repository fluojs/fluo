import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const workspaceBuildClosurePath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const runtimeRootPath = resolve(packageRootPath, 'dist/index.js');
const declarationRootPath = resolve(packageRootPath, 'dist/index.d.ts');
const requiredArtifactPaths = [runtimeRootPath, declarationRootPath] as const;
const removedRuntimeExports = [
  'createCookieAuthPreset',
  'createCookieAuthStrategyRegistration',
  'createCookieManager',
] as const;
const removedDeclarationExports = [
  ...removedRuntimeExports,
  'CookieAuthPresetConfig',
] as const;
const publishedResultMarker = 'FLUO_PASSPORT_PUBLISHED_CONTRACT_RESULT=' as const;

function collectConsumerDiagnostics(sourceText: string): readonly ts.Diagnostic[] {
  const consumerEntryPath = resolve(packageRootPath, 'dist/__fluo-passport-consumer__.ts');
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = ((fileName: string) =>
    resolve(fileName) === consumerEntryPath || ts.sys.fileExists(fileName)) as typeof host.fileExists;
  host.readFile = ((fileName: string) =>
    resolve(fileName) === consumerEntryPath ? sourceText : ts.sys.readFile(fileName)) as typeof host.readFile;
  host.getSourceFile = ((fileName: string, languageVersionOrOptions, ...rest) =>
    resolve(fileName) === consumerEntryPath
      ? ts.createSourceFile(consumerEntryPath, sourceText, languageVersionOrOptions, true, ts.ScriptKind.TS)
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

describe('@fluojs/passport published cookie preset contract', () => {
  beforeAll(async () => {
    if (requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
      return;
    }

    await execFileAsync(process.execPath, [workspaceBuildClosurePath, '@fluojs/passport'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('removes manual cookie helpers from the published JavaScript entrypoint', () => {
    // Given
    expect(requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))).toBe(true);
    const probe = [
      "const passport = await import('@fluojs/passport');",
      `process.stdout.write(${JSON.stringify(publishedResultMarker)} + JSON.stringify({`,
      '  cookieAuthModule: typeof passport.CookieAuthModule,',
      '  cookieManager: typeof passport.CookieManager,',
      `  removed: ${JSON.stringify(removedRuntimeExports)}.filter((name) => name in passport),`,
      '}));',
    ].join('\n');

    // When
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: packageRootPath,
      encoding: 'utf8',
    });
    const serializedResult = result.stdout
      .split('\n')
      .find((line) => line.startsWith(publishedResultMarker));

    // Then
    expect(result.status, [result.stdout, result.stderr].filter(Boolean).join('\n')).toBe(0);
    expect(serializedResult, result.stdout).toBeDefined();
    expect(JSON.parse(serializedResult?.slice(publishedResultMarker.length) ?? 'null')).toEqual({
      cookieAuthModule: 'function',
      cookieManager: 'function',
      removed: [],
    });
  });

  it.each(removedDeclarationExports)('rejects removed %s from the published declaration entrypoint', (exportName) => {
    // Given
    expect(requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))).toBe(true);
    const sourceText = exportName === 'CookieAuthPresetConfig'
      ? `import type { ${exportName} } from '@fluojs/passport';\nexport type Consumer = ${exportName};\n`
      : `import { ${exportName} } from '@fluojs/passport';\nvoid ${exportName};\n`;

    // When
    const diagnostics = collectConsumerDiagnostics(sourceText);
    // Then
    expect(diagnostics.some((diagnostic) =>
      (diagnostic.code === 2305 || diagnostic.code === 2724)
      && ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes(exportName),
    )).toBe(true);
  });

  it('keeps the replacement types available from the published declaration entrypoint', () => {
    // Given
    expect(requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))).toBe(true);
    const sourceText = [
      "import { CookieAuthModule, CookieManager } from '@fluojs/passport';",
      "import type { CookieManagerConfig } from '@fluojs/passport';",
      'const config: CookieManagerConfig = { accessTokenCookieName: "session_access" };',
      'CookieAuthModule.forRoot(config);',
      'CookieManager.create(config);',
    ].join('\n');

    // When
    const diagnostics = collectConsumerDiagnostics(sourceText);

    // Then
    expect(formatDiagnostics(diagnostics)).toBe('');
  });
});
