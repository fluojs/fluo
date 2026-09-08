import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
let root: string;
let fixture: string;
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
  const program = ts.createProgram([fixture], options, host);
  const packageDeclarations = program.getSourceFiles().filter((file) =>
    file.fileName.includes('/packages/') && file.fileName !== fixture,
  );
  expect(packageDeclarations.length).toBeGreaterThan(0);
  for (const declaration of packageDeclarations) {
    expect(declaration.fileName.startsWith(join(root, 'packages/'))).toBe(true);
    expect(declaration.isDeclarationFile).toBe(true);
  }
  return ts.getPreEmitDiagnostics(program);
}

describe('emitted application accessor and public token declarations', () => {
  afterAll(async () => {
    if (root) await rm(root, { force: true, recursive: true });
  });

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fluo-next-application-declarations-')));
    fixture = join(root, 'consumer/public-consumer.mts');
    const packages = resolveWorkspaceBuildOrder('@fluojs/platform-nextjs', repositoryRoot);
    const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', buildClosureScript,
      'packages/testing/src/babel-decorators-plugin.ts',
      ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repositoryRoot, entry), join(root, entry), {
        recursive: true,
        // Relative workspace links resolve within the cold fixture, not the checkout.
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp'].includes(basename(source)),
      });
    }
    // The root has only external dependencies/build tools; workspace links were copied above.
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    await mkdir(join(root, 'consumer/node_modules/@fluojs'), { recursive: true });
    for (const name of packages) {
      const packageRoot = join(root, 'packages', name.slice('@fluojs/'.length));
      expect(existsSync(join(packageRoot, 'dist'))).toBe(false);
      // Resolve through the copied real manifest/export map, without Fluo paths aliases.
      await symlink(packageRoot, join(root, 'consumer/node_modules', name), 'dir');
    }
    await execFileAsync(process.execPath, [join(root, buildClosureScript), '@fluojs/platform-nextjs'], {
      cwd: root,
      env: process.env,
    });
  }, 300_000);

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
