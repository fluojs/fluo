import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { transformFileAsync } from '@babel/core';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const requiredArtifactPaths = [
  resolve(packageRootPath, 'dist/index.js'),
  resolve(packageRootPath, 'dist/adapter.js'),
  resolve(packageRootPath, 'dist/adapter.d.ts'),
  resolve(packageRootPath, 'dist/index.d.ts'),
] as const;
const babelConfigPath = resolve(repoRootPath, 'tooling/babel/babel.config.cjs');
const buildTsconfigPath = resolve(packageRootPath, 'tsconfig.build.json');

function readRuntimeExports(filePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const runtime = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }

    if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name) {
      runtime.add(statement.name.text);
    }
  }

  return [...runtime].sort();
}

function normalizeAst(sourceText: string, filePath: string, scriptKind: ts.ScriptKind): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  return ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
    .printFile(sourceFile);
}

async function emitSourceRuntime(): Promise<string> {
  const result = await transformFileAsync(resolve(packageRootPath, 'src/adapter.ts'), {
    babelrc: false,
    configFile: babelConfigPath,
  });

  if (typeof result?.code !== 'string') {
    throw new TypeError('Babel did not emit the Cloudflare Workers adapter runtime.');
  }

  return result.code;
}

function emitSourceDeclarations(): string {
  const config = ts.readConfigFile(buildTsconfigPath, ts.sys.readFile);

  if (config.error) {
    throw new TypeError(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    packageRootPath,
    { declarationMap: false },
    buildTsconfigPath,
  );
  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
  const adapterDeclarationPath = resolve(packageRootPath, 'dist/adapter.d.ts');
  let adapterDeclaration: string | undefined;
  const emitResult = program.emit(
    undefined,
    (filePath, contents) => {
      if (resolve(filePath) === adapterDeclarationPath) {
        adapterDeclaration = contents;
      }
    },
    undefined,
    true,
  );
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics];

  if (diagnostics.length > 0) {
    throw new TypeError(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (filePath) => filePath,
      getCurrentDirectory: () => repoRootPath,
      getNewLine: () => '\n',
    }));
  }

  if (adapterDeclaration === undefined) {
    throw new TypeError('TypeScript did not emit the Cloudflare Workers adapter declaration.');
  }

  return adapterDeclaration;
}

function readExportAllTargets(filePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  return sourceFile.statements
    .filter(ts.isExportDeclaration)
    .filter((statement) => statement.exportClause === undefined)
    .flatMap((statement) =>
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    )
    .sort();
}

describe('@fluojs/platform-cloudflare-workers published artifacts', () => {
  beforeAll(async () => {
    if (requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/platform-cloudflare-workers'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('keeps request context, WebSocket, SSE, and shutdown runtime behavior structurally aligned with source', async () => {
    // Given: the package manifest publishes its root runtime from dist/index.js.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          import: './dist/index.js',
        },
      },
    });

    const sourceRootPath = resolve(packageRootPath, 'src/index.ts');
    const sourceAdapterPath = resolve(packageRootPath, 'src/adapter.ts');
    const runtimeRootPath = resolve(packageRootPath, 'dist/index.js');
    const runtimeAdapterPath = resolve(packageRootPath, 'dist/adapter.js');

    // When: source is transformed with the production Babel config and the published runtime is parsed.
    const runtimeRoot = await import(pathToFileURL(runtimeRootPath).href);
    const emittedSourceRuntime = await emitSourceRuntime();

    // Then: the complete executable AST and manifest-root exports match, including lifecycle internals.
    expect(normalizeAst(
      readFileSync(runtimeAdapterPath, 'utf8'),
      runtimeAdapterPath,
      ts.ScriptKind.JS,
    )).toEqual(normalizeAst(emittedSourceRuntime, sourceAdapterPath, ts.ScriptKind.JS));
    expect(readExportAllTargets(runtimeRootPath)).toEqual(readExportAllTargets(sourceRootPath));
    expect(Object.keys(runtimeRoot).sort()).toEqual(readRuntimeExports(sourceAdapterPath));
  });

  it('keeps declaration members and signatures structurally aligned with source', () => {
    // Given: the package manifest publishes its root declarations from dist/index.d.ts.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          types: './dist/index.d.ts',
        },
      },
    });

    const sourceRootPath = resolve(packageRootPath, 'src/index.ts');
    const sourceAdapterPath = resolve(packageRootPath, 'src/adapter.ts');
    const declarationRootPath = resolve(packageRootPath, 'dist/index.d.ts');
    const declarationAdapterPath = resolve(packageRootPath, 'dist/adapter.d.ts');

    // When: declarations are emitted in memory from source and the published declaration is parsed.
    const emittedSourceDeclaration = emitSourceDeclarations();

    // Then: every declaration member/signature and the manifest-root export graph match source.
    expect(normalizeAst(
      readFileSync(declarationAdapterPath, 'utf8'),
      declarationAdapterPath,
      ts.ScriptKind.TS,
    )).toEqual(normalizeAst(emittedSourceDeclaration, sourceAdapterPath, ts.ScriptKind.TS));
    expect(readExportAllTargets(declarationRootPath)).toEqual(readExportAllTargets(sourceRootPath));
  });
});
