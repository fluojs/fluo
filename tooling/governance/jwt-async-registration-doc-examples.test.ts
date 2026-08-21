import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCompilerHost,
  createProgram,
  createSourceFile,
  DiagnosticCategory,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  ScriptKind,
  ScriptTarget,
  type CompilerOptions,
} from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplePath = join(repoRoot, 'tooling', 'governance', 'jwt-async-registration-doc-example.ts');
const governedDocuments = [
  'packages/jwt/README.md',
  'packages/jwt/README.ko.md',
  'book/beginner/ch14-jwt.md',
  'book/beginner/ch14-jwt.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function requireAsyncRegistrationExample(markdown: string): string {
  const example = Array.from(
    markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/gu),
    (match) => match[1],
  ).find((candidate) => candidate?.includes('JwtModule.forRootAsync') === true);

  if (example === undefined) {
    throw new TypeError('Missing canonical JwtModule.forRootAsync TypeScript example.');
  }

  return example;
}

function compileExample(sourceText: string): readonly string[] {
  const compilerOptions: CompilerOptions = {
    baseUrl: repoRoot,
    exactOptionalPropertyTypes: true,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    paths: {
      '@fluojs/core/internal': ['packages/core/src/internal.ts'],
      '@fluojs/core/request-pipeline': ['packages/core/src/request-pipeline.ts'],
      '@fluojs/*': ['packages/*/src/index.ts'],
    },
    skipLibCheck: true,
    strict: true,
    target: ScriptTarget.ES2022,
    types: ['node'],
  };
  const host = createCompilerHost(compilerOptions, true);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  host.fileExists = (fileName) => fileName === examplePath || defaultFileExists(fileName);
  host.readFile = (fileName) => fileName === examplePath ? sourceText : defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === examplePath
      ? createSourceFile(fileName, sourceText, languageVersion, true, ScriptKind.TS)
      : defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);

  const program = createProgram([examplePath], compilerOptions, host);

  return getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error && diagnostic.file?.fileName === examplePath)
    .map((diagnostic) => {
      const message = flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return message;
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${position.line + 1}:${position.character + 1} ${message}`;
    });
}

describe('JWT async registration documentation examples', () => {
  it.each(governedDocuments)('%s compiles against real public package types', (relativePath) => {
    // Given
    const example = requireAsyncRegistrationExample(read(relativePath));

    // When
    const diagnostics = compileExample(example);

    // Then
    expect(diagnostics).toEqual([]);
  });
});
