import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

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

type ExportSurface = {
  readonly declarations: readonly string[];
  readonly runtime: readonly string[];
};

function readExportSurface(filePath: string): ExportSurface {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations = new Set<string>();
  const runtime = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }

    if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name
    ) {
      declarations.add(statement.name.text);
      if (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
        runtime.add(statement.name.text);
      }
    }
  }

  return {
    declarations: [...declarations].sort(),
    runtime: [...runtime].sort(),
  };
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

  it('keeps the manifest-exported runtime structurally aligned with the source root', async () => {
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

    // When: the manifest root runtime is imported and its export graph is inspected.
    const runtimeRoot = await import(pathToFileURL(runtimeRootPath).href);

    // Then: dist/index.js re-exports every current runtime value from the source adapter root.
    expect(readExportAllTargets(runtimeRootPath)).toEqual(readExportAllTargets(sourceRootPath));
    expect(Object.keys(runtimeRoot).sort()).toEqual(readExportSurface(sourceAdapterPath).runtime);
  });

  it('keeps the manifest-exported declarations structurally aligned with the source root', () => {
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

    // When: the manifest root declaration and adapter declaration export graphs are inspected.
    const sourceSurface = readExportSurface(sourceAdapterPath);
    const declarationSurface = readExportSurface(declarationAdapterPath);

    // Then: dist/index.d.ts reaches the complete current source declaration surface.
    expect(readExportAllTargets(declarationRootPath)).toEqual(readExportAllTargets(sourceRootPath));
    expect(declarationSurface.declarations).toEqual(sourceSurface.declarations);
  });
});
