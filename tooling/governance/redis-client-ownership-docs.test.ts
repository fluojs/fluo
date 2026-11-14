import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as core from '@fluojs/core';
import * as redis from '@fluojs/redis';
import {
  createCompilerHost,
  createProgram,
  createSourceFile,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  ScriptKind,
  ScriptTarget,
  transpileModule,
  type CompilerOptions,
} from 'typescript';
import { describe, expect, it } from 'vitest';

import { collectWorkspaceAliases } from '../vitest/src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPairs = [
  ['packages/redis/README.md', 'packages/redis/README.ko.md'],
  ['book/intermediate/ch03-redis-transport.md', 'book/intermediate/ch03-redis-transport.ko.md'],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function codeFences(markdown: string): string[] {
  return Array.from(markdown.matchAll(/^```[^\n]*\n[\s\S]*?^```/gmu), (match) => match[0]);
}

function typescriptExamples(markdown: string): string[] {
  return codeFences(markdown)
    .filter((fence) => /^```(?:ts|typescript)\n/u.test(fence))
    .map((fence) => fence.slice(fence.indexOf('\n') + 1, -3));
}

function headings(markdown: string): string[] {
  const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```/gmu, '');
  return Array.from(prose.matchAll(/^#{1,6} .+$/gmu), (match) => match[0]);
}

function compileExamples(sources: ReadonlyMap<string, string>) {
  const compilerOptions: CompilerOptions = {
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: Object.fromEntries(
      Object.entries(collectWorkspaceAliases(new URL('../../', import.meta.url)))
        .map(([name, sourcePath]) => [name, [sourcePath]]),
    ),
    strict: true,
    target: ScriptTarget.ES2022,
    types: ['node'],
  };
  const host = createCompilerHost(compilerOptions, true);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => sources.has(fileName) || defaultFileExists(fileName);
  host.readFile = (fileName) => sources.get(fileName) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(fileName);
    return source === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : createSourceFile(fileName, source, languageVersion, true, ScriptKind.TS);
  };

  return createProgram([...sources.keys()], compilerOptions, host);
}

function evaluateNamedClients(source: string): Record<string, unknown> {
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics).toEqual([]);
  const exports: Record<string, unknown> = {};
  const publicPackages = new Map<string, unknown>([
    ['@fluojs/core', core],
    ['@fluojs/redis', redis],
  ]);

  runInNewContext(compiled.outputText, {
    exports,
    Symbol,
    require(name: string) {
      if (!publicPackages.has(name)) {
        throw new Error(`Unexpected runtime import: ${name}`);
      }
      return publicPackages.get(name);
    },
  }, { timeout: 1_000 });

  return exports;
}

function getOwningModuleBlock(content: string, factoryName: string): string {
  const factoryDeclarationIndex = content.indexOf(`export class ${factoryName} {`);
  const moduleDeclarationIndex = content.indexOf('@Module({', factoryDeclarationIndex);
  const moduleEndIndex = content.indexOf('\n})', moduleDeclarationIndex);

  expect(
    factoryDeclarationIndex,
    `must declare ${factoryName} before its owning module`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    moduleDeclarationIndex,
    `must declare an owning module after ${factoryName}`,
  ).toBeGreaterThan(factoryDeclarationIndex);
  expect(moduleEndIndex, `must close the owning module for ${factoryName}`).toBeGreaterThan(
    moduleDeclarationIndex,
  );

  return content.slice(moduleDeclarationIndex, moduleEndIndex + '\n})'.length);
}

describe('Redis client ownership documentation', () => {
  it('typechecks all documented Pub/Sub and Named Clients fences against real public exports', () => {
    const sources = new Map<string, string>();
    for (const relativePath of documentPairs.flat()) {
      const examples = typescriptExamples(read(relativePath)).filter((source) =>
        source.includes('RedisPubSubMicroserviceTransport') || source.includes('class AnalyticsStore'),
      );
      expect(examples, relativePath).toHaveLength(2);
      examples.forEach((source, index) => {
        // Resolve ioredis from the package's installed peer, without replacing its declarations.
        const examplePath = join(repoRoot, 'packages/redis', `${relativePath.replaceAll('/', '-')}-${index}.ts`);
        sources.set(examplePath, source);
      });
    }

    const program = compileExamples(sources);
    const diagnostics = getPreEmitDiagnostics(program).map((diagnostic) => {
      const message = flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return `TS${diagnostic.code}: ${message}`;
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`;
    });

    expect(diagnostics).toEqual([]);
    expect(program.getSourceFiles().some((file) => file.fileName.endsWith('/ioredis/built/index.d.ts'))).toBe(true);
    const checker = program.getTypeChecker();
    for (const [sourcePath, exported] of [
      ['packages/microservices/src/index.ts', false],
      ['packages/microservices/src/transports/redis-transport.ts', true],
    ] as const) {
      const source = program.getSourceFile(join(repoRoot, sourcePath));
      const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
      expect(symbol, sourcePath).toBeDefined();
      const exports = symbol === undefined ? [] : checker.getExportsOfModule(symbol).map((entry) => entry.name);
      expect(exports.includes('RedisPubSubMicroserviceTransport'), sourcePath).toBe(exported);
    }
  }, 30_000);

  it('keeps the manifest root, Pub/Sub and Streams entrypoints on their declared public boundaries', () => {
    const manifest = JSON.parse(read('packages/microservices/package.json'));

    expect(manifest.exports).toMatchObject({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './redis': { types: './dist/transports/redis-transport.d.ts', import: './dist/transports/redis-transport.js' },
      './redis-streams': {
        types: './dist/transports/redis-streams-transport.d.ts',
        import: './dist/transports/redis-streams-transport.js',
      },
    });
  });

  it.each(documentPairs[0])('%s evaluates Named Clients with AnalyticsStore registered in AppModule', (relativePath) => {
    const examples = typescriptExamples(read(relativePath)).filter((source) => source.includes('class AnalyticsStore'));
    expect(examples).toHaveLength(1);
    const example = examples[0];
    if (example === undefined) {
      throw new Error(`Missing Named Clients example in ${relativePath}`);
    }

    const { AppModule, AnalyticsStore } = evaluateNamedClients(example);

    if (typeof AppModule !== 'function' || typeof AnalyticsStore !== 'function') {
      throw new Error(`Missing Named Clients classes in ${relativePath}`);
    }
    expect(core.getModuleMetadata(AppModule)?.providers).toEqual([AnalyticsStore]);
  });

  it('rejects a Named Clients example that registers AnalyticsStore before declaring it', () => {
    const example = typescriptExamples(read(documentPairs[0][0]))
      .find((source) => source.includes('class AnalyticsStore'));
    if (example === undefined) {
      throw new Error('Missing Named Clients example');
    }
    const providerStart = example.indexOf('@Inject(');
    const moduleStart = example.indexOf('@Module({');
    const lateProvider = example.slice(0, providerStart)
      + example.slice(moduleStart) + example.slice(providerStart, moduleStart);

    expect(() => evaluateNamedClients(lateProvider)).toThrow(/Cannot access 'AnalyticsStore' before initialization/u);
  });

  it('resolves every English README table-of-contents fragment to a heading', () => {
    const markdown = read(documentPairs[0][0]);
    const toc = /^## Table of Contents\n([\s\S]*?)(?=^## )/mu.exec(markdown)?.[1];
    expect(toc).toBeDefined();
    const fragments = Array.from((toc ?? '').matchAll(/\]\(#([^)]+)\)/gu), (match) => match[1]);
    const anchors = headings(markdown).map((heading) =>
      heading.replace(/^#+ /u, '').toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-'),
    );

    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.filter((fragment) => !anchors.includes(fragment))).toEqual([]);
  });

  it.each(documentPairs)('%s and %s retain matching fences and heading structure', (englishPath, koreanPath) => {
    const english = read(englishPath);
    const korean = read(koreanPath);

    expect(codeFences(korean)).toEqual(codeFences(english));
    expect(headings(korean).map((heading) => heading.indexOf(' ')))
      .toEqual(headings(english).map((heading) => heading.indexOf(' ')));
  });

  it('keeps client construction and raw Pub/Sub cleanup ownership aligned across companion docs', () => {
    const failureSafeShutdown = `  const shutdownErrors: unknown[] = [];

  for (const shutdown of [
    () => transport.close(),
    () => subscriber.quit(),
    () => publisher.quit(),
  ]) {
    try {
      await shutdown();
    } catch (error) {
      shutdownErrors.push(error);
    }
  }

  if (shutdownErrors.length > 0) {
    throw new AggregateError(shutdownErrors, 'Failed to close Redis notification transport.');
  }`;

    expect(read('packages/redis/README.md')).toContain('does not adopt an externally constructed client');
    expect(read('packages/redis/README.ko.md')).toContain('외부에서 만든 client를 채택하지 않습니다');
    expect(read('book/intermediate/ch03-redis-transport.md')).toContain('Closing the transport only unsubscribes the subscriber');
    expect(read('book/intermediate/ch03-redis-transport.ko.md')).toContain('Transport를 닫아도 subscriber 구독만 해제되므로');
    expect(read('book/intermediate/ch03-redis-transport.md')).toContain(failureSafeShutdown);
    expect(read('book/intermediate/ch03-redis-transport.ko.md')).toContain(failureSafeShutdown);
    expect(read('docs/getting-started/migrate-from-nestjs.md')).toContain('rather than accepting or adopting an external client');
    expect(read('docs/getting-started/migrate-from-nestjs.ko.md')).toContain('외부 client를 받거나 채택하지 않고');
    expect(read('docs/CONTEXT.md')).toContain('Each `RedisModule.forRoot(...)` registration creates a new client');
    expect(read('docs/CONTEXT.ko.md')).toContain('각 `RedisModule.forRoot(...)` 등록은 최종 option으로 새 client를 생성');
    expect(read('docs/CONTEXT.md')).toContain(
      'Every named-token consumer must still be explicitly declared',
    );
    expect(read('docs/CONTEXT.ko.md')).toContain(
      'named token consumer는 importing module의 `providers`에 나열하기 전에 명시적으로 선언해야',
    );
  });

  it('registers named-token Pub/Sub factories in the owning module providers', () => {
    const namedTokenFactoryExamples: ReadonlyArray<readonly [string, string]> = [
      ['packages/redis/README.md', 'PubSubTransportFactory'],
      ['packages/redis/README.ko.md', 'PubSubTransportFactory'],
      ['book/intermediate/ch03-redis-transport.md', 'NotificationTransportFactory'],
      ['book/intermediate/ch03-redis-transport.ko.md', 'NotificationTransportFactory'],
    ];

    for (const [relativePath, factoryName] of namedTokenFactoryExamples) {
      const content = read(relativePath);
      const moduleBlock = getOwningModuleBlock(content, factoryName);

      expect(content, `${relativePath} must declare ${factoryName}`).toContain(
        `export class ${factoryName} {`,
      );
      expect(moduleBlock, `${relativePath} must import Redis registrations`).toContain(
        'RedisModule.forRoot(',
      );
      expect(moduleBlock, `${relativePath} must register ${factoryName} as a provider`).toContain(
        `  providers: [${factoryName}],`,
      );
    }
  });

  it('states that named-token Redis consumers need explicit provider registration in the migration row', () => {
    expect(read('docs/getting-started/migrate-from-nestjs.md')).toContain(
      'Register every `getRedisClientToken(name)` consumer in the importing module graph',
    );
    expect(read('docs/getting-started/migrate-from-nestjs.ko.md')).toContain(
      '`getRedisClientToken(name)` consumer는 importing module graph의 `providers`에 명시적으로 등록',
    );
  });
});
