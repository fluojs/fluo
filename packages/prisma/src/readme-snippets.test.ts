import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as core from '@fluojs/core';
import { Container } from '@fluojs/di';
import * as http from '@fluojs/http';
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
  transpileModule,
} from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import * as prisma from './index.js';

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
  const sourcePath = join(repoRoot, '.virtual-prisma-readme', `${relativePath}.ts`);
  const prismaClientPath = join(dirname(sourcePath), 'prisma-client.ts');
  const virtualFiles = new Map([
    [sourcePath, sourceText],
    [prismaClientPath, 'export interface PrismaClient { $connect(): Promise<void>; }'],
  ]);

  for (const [relativePath, companionSource] of companionSources) {
    virtualFiles.set(join(dirname(sourcePath), relativePath), companionSource);
  }

  const options = {
    exactOptionalPropertyTypes: true,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    paths: {
      '@prisma/client': [prismaClientPath],
      '@fluojs/core/internal': [join(repoRoot, 'packages/core/src/internal.ts')],
      '@fluojs/core/request-pipeline': [join(repoRoot, 'packages/core/src/request-pipeline.ts')],
      '@fluojs/*': [join(repoRoot, 'packages/*/src/index.ts')],
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

  return getPreEmitDiagnostics(createProgram([sourcePath], options, host))
    .filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error
      && (diagnostic.file === undefined || virtualFiles.has(diagnostic.file.fileName)))
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
  expectedInjectTokens: readonly string[] = [token],
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
  if (
    injectedTokens.length !== expectedInjectTokens.length
    || injectedTokens.some((injectedToken, index) => injectedToken !== expectedInjectTokens[index])
  ) {
    throw new TypeError(
      `Expected @Inject(${expectedInjectTokens.join(', ')}) on ${className}; received @Inject(${injectedTokens.join(', ')}).`,
    );
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
    it(`compiles the ${locale} explicit-target @Transaction service example against public package types`, () => {
      const snippet = readmeSnippet(file, [
        'class UserService',
        "from './user.repository'",
        '@Transaction((self) => self.prisma)',
      ]);

      const expectedInjectTokens = ['PrismaService', 'UserRepository'];
      expectInjectedConstructorDependency(snippet, 'UserService', 'prisma', 'PrismaService', expectedInjectTokens);
      expectInjectedConstructorDependency(snippet, 'UserService', 'repo', 'UserRepository', expectedInjectTokens);
      for (const malformed of [false, true]) {
        const source = malformed ? snippet.replace('const user =', 'const regression: number = "invalid";\n    const user =') : snippet;
        expect(readmeSnippetDiagnostics(
          `${file}-transaction`,
          `${source}\n\ntype CreateUserDto = { readonly email: string };`,
          new Map([['user.repository.ts', userRepositorySource]]),
        )).toEqual(malformed ? [expect.stringContaining("Type 'string' is not assignable to type 'number'.")] : []);
      }
    });

    it(`rejects the ${locale} explicit-target @Transaction service example with the wrong injected token`, () => {
      const snippet = readmeSnippet(file, [
        'class UserService',
        "from './user.repository'",
        '@Transaction((self) => self.prisma)',
      ]);
      const malformedSnippet = snippet.replace('@Inject(PrismaService, UserRepository)', '@Inject(UserRepository)');

      expect(() => expectInjectedConstructorDependency(
        malformedSnippet,
        'UserService',
        'prisma',
        'PrismaService',
        ['PrismaService', 'UserRepository'],
      )).toThrowError('Expected @Inject(PrismaService, UserRepository) on UserService; received @Inject(UserRepository).');
    });

    it(`compiles the ${locale} explicit request transaction example against public package types`, () => {
      const snippet = readmeSnippet(file, ['class OrdersController', 'requestTransaction(']);

      const expectedInjectTokens = ['PrismaService', 'OrdersService'];
      expectInjectedConstructorDependency(snippet, 'OrdersController', 'orders', 'OrdersService', expectedInjectTokens);
      expectInjectedConstructorDependency(snippet, 'OrdersController', 'prisma', 'PrismaService', expectedInjectTokens);
      for (const malformed of [false, true]) {
        const source = malformed ? snippet.replace('const { request }', 'const regression: number = "invalid";\n    const { request }') : snippet;
        expect(readmeSnippetDiagnostics(
          `${file}-interceptor`,
          source,
          new Map([
            ['orders.service.ts', 'export class OrdersService { async checkout(input: { readonly orderId: string }) { return { id: input.orderId }; } }'],
          ]),
        )).toEqual(malformed ? [expect.stringContaining("Type 'string' is not assignable to type 'number'.")] : []);
      }
    });

    it(`dispatches the ${locale} checkout example with the body DTO and identical request signal`, async () => {
      const snippet = readmeSnippet(file, ['class OrdersController', 'requestTransaction(']);
      class OrdersService {
        checkout = vi.fn(async (input: { readonly orderId: string }) => ({ id: input.orderId }));
      }
      const exports: { OrdersController?: core.Constructor<object> } = {};
      const modules = new Map<string, unknown>([
        ['@fluojs/core', core], ['@fluojs/http', http], ['@fluojs/prisma', prisma],
        ['./orders.service', { OrdersService }],
      ]);
      const { outputText } = transpileModule(snippet, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
      });
      new Function('require', 'exports', outputText)((specifier: string) => modules.get(specifier), exports);
      const controller = exports.OrdersController;
      if (controller === undefined) throw new TypeError('Missing OrdersController export.');
      const orders = new OrdersService();
      const service = new prisma.PrismaService({});
      const transaction = vi.spyOn(service, 'requestTransaction');
      const root = new Container().register(controller, { provide: OrdersService, useValue: orders }, { provide: prisma.PrismaService, useValue: service });
      const dispatcher = http.createDispatcher({ rootContainer: root, handlerMapping: http.createHandlerMapping([{ controllerToken: controller }]) });
      const signal = new AbortController().signal;
      const response: http.FrameworkResponse = {
        committed: false, headers: {},
        redirect() { throw new TypeError('Unexpected redirect.'); },
        send: vi.fn(), setHeader(name, value) { this.headers[name] = value; },
        setStatus(code) { this.statusCode = code; },
      };

      try {
        await dispatcher.dispatch({
          method: 'POST', path: '/orders/checkout', url: '/orders/checkout',
          body: { orderId: 'order-4168' }, cookies: {}, headers: {}, params: {}, query: {}, raw: {}, signal,
        }, response);

        expect(orders.checkout).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ orderId: 'order-4168' }));
        expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), signal);
        expect(transaction.mock.calls[0]?.[1]).toBe(signal);
        expect(response.send).toHaveBeenCalledExactlyOnceWith({ id: 'order-4168' });
      } finally {
        transaction.mockRestore();
        await root.dispose();
      }
    });
  }
});
