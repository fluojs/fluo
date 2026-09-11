import { execFile, spawnSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder } from '../../../tooling/scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
let fixtureRoot: string;
let packageRoot: string;

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { force: true, recursive: true });
});

beforeAll(async () => {
  fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'fluo-di-declarations-')));
  packageRoot = join(fixtureRoot, 'packages/di');
  const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
  const packages = resolveWorkspaceBuildOrder('@fluojs/di', repositoryRoot);
  for (const entry of [
    'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
    'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
    'tooling/scripts/clean-dist.mjs', buildClosureScript,
    ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
  ]) {
    await cp(join(repositoryRoot, entry), join(fixtureRoot, entry), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => !['dist', '.vite', '.vite-temp', '.omo'].includes(basename(source)),
    });
  }
  await symlink(join(repositoryRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
  await execFileAsync(process.execPath, [
    join(fixtureRoot, buildClosureScript), '@fluojs/di',
  ], { cwd: fixtureRoot, env: process.env });
}, 300_000);

it('removes compatibility names from the complete emitted declaration export graph', () => {
  const entrypoints = [
    'core/dist/index.d.ts',
    'core/dist/internal.d.ts',
    'core/dist/request-pipeline.d.ts',
    'di/dist/index.d.ts',
    'di/dist/internal.d.ts',
  ].map((path) => join(fixtureRoot, 'packages', path));
  const program = ts.createProgram(entrypoints, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
  for (const path of entrypoints) {
    const source = program.getSourceFile(path);
    if (!source) throw new Error(`Missing emitted declaration: ${path}`);
    const module = checker.getSymbolAtLocation(source);
    if (!module) throw new Error(`Missing public module symbol: ${path}`);
    const names = checker.getExportsOfModule(module).map((symbol) => symbol.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of ['Global', 'forwardRef', 'optional', 'ForwardRefFn', 'OptionalToken']) {
      expect(names, path).not.toContain(name);
    }
  }
});

it('compiles canonical consumers against emitted public declarations', () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--ignoreConfig',
    'packages/di/typecheck/canonical-injection.ts',
  ], { cwd: fixtureRoot, encoding: 'utf8' });

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});

it('uses emitted JavaScript through every public entrypoint without compatibility exports', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import * as core from '@fluojs/core';
    import * as di from '@fluojs/di';
    import * as coreInternal from '@fluojs/core/internal';
    import * as pipeline from '@fluojs/core/request-pipeline';
    import * as diInternal from '@fluojs/di/internal';
    for (const api of [core, coreInternal, pipeline, di, diInternal]) {
      for (const name of ['Global', 'forwardRef', 'optional', 'ForwardRefFn', 'OptionalToken']) {
        assert.equal(Object.hasOwn(api, name), false, name);
      }
    }
    assert.equal(Object.hasOwn(di, 'Scope'), false);
    class Dependency {}
    class Service {
      constructor(dependency, optional) { this.dependency = dependency; this.optional = optional; }
    }
    const context = { kind: 'class', name: 'Service', metadata: {}, addInitializer() {} };
    const resolver = () => Dependency;
    const deferred = di.ForwardRef.create(resolver);
    const optional = di.Optional.create('missing');
    assert.equal(deferred.forwardRef, resolver);
    assert.ok(Object.isFrozen(deferred) && Object.isFrozen(optional));
    core.Inject(deferred, optional)(Service, context);
    const container = new di.Container().register(Dependency, Service);
    try {
      const service = await container.resolve(Service);
      assert.ok(service instanceof Service);
      assert.equal(service.dependency, await container.resolve(Dependency));
      assert.equal(service.optional, undefined);
    } finally {
      await container.dispose();
    }
    console.log('PUBLIC_ENTRYPOINTS_OK');
  `], { cwd: packageRoot, encoding: 'utf8' });

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout.trim()).toBe('PUBLIC_ENTRYPOINTS_OK');
});
