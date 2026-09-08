import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const fixture = fileURLToPath(new URL('../public-consumer.mts', import.meta.url));
const imports = `
import { publicToken, type PublicToken, type Token } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { defineNextApplication, type NextApplicationOptions } from '@fluojs/platform-nextjs';
interface Service { title(): string }
const token = publicToken<Service>('consumer/blog/service/v1');
const container = new Container();
`;

function compile(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    paths: {
      ...Object.fromEntries(['core', 'di', 'platform-nextjs'].map((name) => [
        `@fluojs/${name}`,
        [fileURLToPath(new URL(`../../${name}/dist/index.d.ts`, import.meta.url))],
      ])),
      // Next's sharp 0.35 dependency ships these declarations but omits its types
      // export condition. Check the real declarations, not an ambient stub or skipLibCheck.
      sharp: [resolve(dirname(createRequire(createRequire(import.meta.url).resolve('next')).resolve('sharp')), '../lib/index.d.ts')],
    },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}

describe('emitted application accessor and public token declarations', () => {
  it('infers services and application values while retaining existing tokens', () => {
    // Given
    const source = `${imports}
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const resolved = container.resolve(token);
type Resolved = Assert<Equal<typeof resolved, Promise<Service>>>;
const options = { key: 'consumer/blog/v1', load: async () => ({ container }) } satisfies NextApplicationOptions<{ container: Container }>;
const get = defineNextApplication(options);
type Application = Assert<Equal<Awaited<ReturnType<typeof get>>, { container: Container }>>;
const symbol: symbol = token;
const ordinary: Token<Service> = token;
const typed: PublicToken<Service> = token;
class ClassService { title() { return 'ok'; } }
const classResult = container.resolve(ClassService);
type ClassResult = Assert<Equal<typeof classResult, Promise<ClassService>>>;
const stringResult: Promise<Service> = container.resolve<Service>('old');
const symbolResult: Promise<Service> = container.resolve<Service>(Symbol.for('old'));
const unknownResult = container.resolve(Symbol('ordinary'));
type UnknownResult = Assert<Equal<typeof unknownResult, Promise<unknown>>>;
`;

    // When
    const diagnostics = compile(source);

    // Then
    expect(diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
  });

  it('rejects incompatible resolved values and malformed accessor inputs at the caller', () => {
    // Given
    const invalid = [
      'const wrong: Promise<number> = container.resolve(token);',
      'const unbranded: PublicToken<Service> = Symbol.for("untyped");',
      'publicToken<Service>(123);',
      'defineNextApplication({ load: async () => ({}) });',
      'defineNextApplication({ key: "app", load: () => ({}) });',
      'defineNextApplication({ key: 123, load: async () => ({}) });',
      'defineNextApplication({ key: "app", load: async () => ({}) })("session");',
    ];

    // When
    const diagnostics = compile(`${imports}${invalid.join('\n')}`);

    // Then
    expect(diagnostics.filter((entry) =>
      entry.file?.fileName !== fixture || entry.start === undefined || entry.code === 2307,
    ).map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n'))).toEqual([]);
    const lines = new Set(diagnostics.flatMap((entry) =>
      entry.file && entry.start !== undefined
        ? [entry.file.getLineAndCharacterOfPosition(entry.start).line]
        : [],
    ));
    const firstLine = imports.split('\n').length - 1;
    expect([...lines].sort((a, b) => a - b)).toEqual(invalid.map((_, index) => firstLine + index));
  });
});
