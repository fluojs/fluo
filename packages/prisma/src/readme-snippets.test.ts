import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  canHaveDecorators,
  createCompilerHost,
  createProgram,
  createSourceFile,
  DiagnosticCategory,
  flattenDiagnosticMessageText,
  getDecorators,
  getPreEmitDiagnostics,
  isCallExpression,
  isClassDeclaration,
  isConstructorDeclaration,
  isIdentifier,
  isTypeReferenceNode,
  ModuleKind,
  ModuleResolutionKind,
  ScriptKind,
  ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const readmes = [
  { file: 'README.md', locale: 'English' },
  { file: 'README.ko.md', locale: 'Korean' },
] as const;
const userRepositorySource = `
type CreateUserInput = { readonly email: string };

export class UserRepository {
  async create(data: CreateUserInput) {
    return { id: 'user-1', ...data };
  }

  async initProfile(userId: string) {
    return { userId };
  }
}
`;

function codeFences(markdown: string): string[] {
  return [...markdown.matchAll(/```typescript\n([\s\S]*?)```/gu)]
    .flatMap((match) => match[1] === undefined ? [] : [match[1]]);
}

function readmeSnippet(file: string, fragments: readonly string[]): string {
  const snippets = codeFences(readFileSync(join(repoRoot, 'packages/prisma', file), 'utf8'))
    .filter((snippet) => fragments.every((fragment) => snippet.includes(fragment)));

  if (snippets.length !== 1 || snippets[0] === undefined) {
    throw new TypeError(`Expected one README snippet in ${file} containing ${fragments.join(', ')}.`);
  }

  return snippets[0];
}

function readmeSnippetDiagnostics(
  relativePath: string,
  sourceText: string,
  companionSources: ReadonlyMap<string, string> = new Map(),
): string[] {
  const sourcePath = join(repoRoot, '.virtual-prisma-readme', relativePath.replace(/\.md$/u, '.ts'));
  const virtualFiles = new Map([[sourcePath, sourceText]]);

  for (const [relativePath, companionSource] of companionSources) {
    virtualFiles.set(join(dirname(sourcePath), relativePath), companionSource);
  }

  const options = {
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
  const host = createCompilerHost(options, true);
  const defaultDirectoryExists = host.directoryExists?.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const virtualDirectories = new Set([...virtualFiles.keys()].map((fileName) => dirname(fileName)));

  host.directoryExists = (directoryName) => virtualDirectories.has(directoryName) || defaultDirectoryExists?.(directoryName) === true;
  host.fileExists = (fileName) => virtualFiles.has(fileName) || defaultFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(fileName) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = virtualFiles.get(fileName);

    return source === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : createSourceFile(fileName, source, languageVersion, true, ScriptKind.TS);
  };

  const program = createProgram([sourcePath], options, host);

  return getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error && diagnostic.file?.fileName === sourcePath)
    .map((diagnostic) => {
      const message = flattenDiagnosticMessageText(diagnostic.messageText, '\n');

      if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return message;
      }

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${position.line + 1}:${position.character + 1} ${message}`;
    });
}

function expectInjectedConstructorDependency(
  sourceText: string,
  className: string,
  parameterName: string,
  token: string,
): void {
  const sourceFile = createSourceFile('readme-snippet.ts', sourceText, ScriptTarget.ES2022, true, ScriptKind.TS);
  const declaration = sourceFile.statements
    .filter(isClassDeclaration)
    .find((statement) => statement.name?.text === className);

  if (declaration === undefined) {
    throw new TypeError(`Missing ${className} declaration.`);
  }

  const injectDecorator = (canHaveDecorators(declaration) ? getDecorators(declaration) ?? [] : [])
    .find((decorator) => isCallExpression(decorator.expression)
      && isIdentifier(decorator.expression.expression)
      && decorator.expression.expression.text === 'Inject');

  if (injectDecorator === undefined || !isCallExpression(injectDecorator.expression)) {
    throw new TypeError(`Missing @Inject(...) on ${className}.`);
  }

  const injectedTokens = injectDecorator.expression.arguments.map((argument) => argument.getText(sourceFile));
  if (injectedTokens.length !== 1 || injectedTokens[0] !== token) {
    throw new TypeError(`Expected @Inject(${token}) on ${className}; received @Inject(${injectedTokens.join(', ')}).`);
  }

  const constructor = declaration.members.find(isConstructorDeclaration);
  const parameter = constructor?.parameters.find(
    (candidate) => isIdentifier(candidate.name) && candidate.name.text === parameterName,
  );

  if (parameter === undefined || parameter.type === undefined || !isTypeReferenceNode(parameter.type)) {
    throw new TypeError(`Missing ${parameterName}: ${token} constructor dependency on ${className}.`);
  }

  const parameterType = parameter.type.typeName.getText(sourceFile);
  if (parameterType !== token) {
    throw new TypeError(`Expected ${parameterName}: ${token} constructor dependency on ${className}; received ${parameterType}.`);
  }
}

describe('@fluojs/prisma README DI snippets', () => {
  for (const { file, locale } of readmes) {
    it(`compiles the ${locale} @Transaction() service example against public package types`, () => {
      const snippet = readmeSnippet(file, ['class UserService', "from './user.repository'", '@Transaction()']);

      expectInjectedConstructorDependency(snippet, 'UserService', 'repo', 'UserRepository');
      expect(
        readmeSnippetDiagnostics(
          `${file}-transaction`,
          `${snippet}\n\ntype CreateUserDto = { readonly email: string };`,
          new Map([['user.repository.ts', userRepositorySource]]),
        ),
      ).toEqual([]);
    });

    it(`rejects the ${locale} @Transaction() service example with the wrong injected token`, () => {
      const snippet = readmeSnippet(file, ['class UserService', "from './user.repository'", '@Transaction()']);
      const malformedSnippet = snippet.replace('@Inject(UserRepository)', '@Inject(PrismaService)');

      expect(() => expectInjectedConstructorDependency(
        malformedSnippet,
        'UserService',
        'repo',
        'UserRepository',
      )).toThrowError('Expected @Inject(UserRepository) on UserService; received @Inject(PrismaService).');
    });

    it(`compiles the ${locale} interceptor compatibility example against public package types`, () => {
      const snippet = readmeSnippet(file, ['class OrdersController', '@UseInterceptors(PrismaTransactionInterceptor)']);

      expectInjectedConstructorDependency(snippet, 'OrdersController', 'orders', 'OrdersService');
      expect(
        readmeSnippetDiagnostics(
          `${file}-interceptor`,
          snippet,
          new Map([
            ['orders.service.ts', 'export class OrdersService { create(): { readonly id: string } { return { id: "order-1" }; } }'],
          ]),
        ),
      ).toEqual([]);
    });
  }
});
