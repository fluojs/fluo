import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
let fixtureRoot: string;

function compile(source: string, consumer = 'runtime') {
  const directory = join(fixtureRoot, consumer);
  const fixture = join(directory, 'consumer.mts');
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixture], options, host);
  const packageFiles = program.getSourceFiles().filter((file) => file.fileName.includes('/@fluojs/'));
  expect(packageFiles.some((file) => file.fileName === join(directory, 'node_modules/@fluojs/core/dist/index.d.ts'))).toBe(true);
  expect(packageFiles.every((file) =>
    file.isDeclarationFile && file.fileName.startsWith(join(directory, 'node_modules/@fluojs/')),
  )).toBe(true);
  return {
    diagnostics: ts.getPreEmitDiagnostics(program).map((entry) => ({
      code: entry.code,
      file: entry.file?.fileName,
      message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
      span: entry.file?.text.slice(entry.start, (entry.start ?? 0) + (entry.length ?? 0)),
    })),
    packageNames: [...new Set(packageFiles.map((file) =>
      file.fileName.split('/node_modules/@fluojs/')[1]?.split('/')[0],
    ))].sort(),
  };
}

describe('public lifecycle declarations', () => {
  beforeAll(async () => {
    fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'fluo-lifecycle-declarations-')));
    for (const consumer of ['core', 'runtime']) {
      for (const name of resolveWorkspaceBuildOrder(`@fluojs/${consumer}`, repositoryRoot)) {
        const source = join(repositoryRoot, 'packages', name.slice('@fluojs/'.length));
        const target = join(fixtureRoot, consumer, 'node_modules', name);
        await mkdir(target, { recursive: true });
        await cp(join(source, 'package.json'), join(target, 'package.json'));
        await cp(join(source, 'dist'), join(target, 'dist'), { recursive: true });
      }
    }
    await cp(
      await realpath(join(repositoryRoot, 'packages/validation/node_modules/@standard-schema/spec')),
      join(fixtureRoot, 'runtime/node_modules/@standard-schema/spec'),
      { recursive: true },
    );
  });

  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('keeps all five core and runtime root types equal in both directions', () => {
    const source = `
import type * as Core from '@fluojs/core';
import type * as Runtime from '@fluojs/runtime';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CoreHooks = [Core.OnModuleInit, Core.OnApplicationBootstrap,
  Core.OnModuleDestroy, Core.OnApplicationShutdown, Core.LifecycleHooks];
type RuntimeHooks = [Runtime.OnModuleInit, Runtime.OnApplicationBootstrap,
  Runtime.OnModuleDestroy, Runtime.OnApplicationShutdown, Runtime.LifecycleHooks];
type Forward = Assert<Equal<CoreHooks, RuntimeHooks>>;
type Backward = Assert<Equal<RuntimeHooks, CoreHooks>>;
declare const core: CoreHooks;
declare const runtime: RuntimeHooks;
const fromCore: RuntimeHooks = core;
const fromRuntime: CoreHooks = runtime;
`;

    const result = compile(source);

    expect(result.diagnostics).toEqual([]);
  });

  for (const owner of ['core', 'runtime']) {
    it(`${owner} lifecycle: single hooks and optional string shutdown compile`, () => {
      const source = `
import type { LifecycleHooks, OnModuleInit, OnApplicationBootstrap,
  OnModuleDestroy, OnApplicationShutdown } from '@fluojs/${owner}';
const init: OnModuleInit = { onModuleInit() {} };
const bootstrap: OnApplicationBootstrap = { async onApplicationBootstrap() {} };
const destroy: OnModuleDestroy = { onModuleDestroy() { return Promise.resolve(); } };
const shutdown: OnApplicationShutdown = { onApplicationShutdown(signal?: string) {} };
const members: LifecycleHooks[] = [init, bootstrap, destroy, shutdown];
shutdown.onApplicationShutdown();
shutdown.onApplicationShutdown('SIGTERM');
`;

      const result = compile(source, owner);

      expect(result.diagnostics).toEqual([]);
      if (owner === 'core') {
        expect(result.packageNames).toEqual(['core', 'persistence']);
      }
    });

    it.each([
      {
        name: 'numeric hook',
        type: 'OnModuleInit',
        input: 'const hook: OnModuleInit = { onModuleInit: 123 };',
        code: 2322,
        span: 'onModuleInit',
      },
      {
        name: 'empty union member',
        type: 'LifecycleHooks',
        input: 'const hook: LifecycleHooks = {};',
        code: 2322,
        span: 'hook',
      },
      {
        name: 'Promise<number> return',
        type: 'OnModuleInit',
        input: 'const hook: OnModuleInit = { onModuleInit() { return Promise.resolve(123); } };',
        code: 2322,
        span: 'onModuleInit',
      },
      {
        name: 'numeric shutdown argument',
        type: 'OnApplicationShutdown',
        input: 'declare const hook: OnApplicationShutdown; hook.onApplicationShutdown(123);',
        code: 2345,
        span: '123',
      },
    ])(`${owner} lifecycle: rejects $name with its compiler diagnostic`, ({ type, input, code, span }) => {
      const source = `import type { ${type} } from '@fluojs/${owner}';\n${input}`;

      const result = compile(source, owner);

      expect(result.diagnostics).toEqual([{
        code,
        file: join(fixtureRoot, owner, 'consumer.mts'),
        message: expect.any(String),
        span,
      }]);
    });
  }
});
